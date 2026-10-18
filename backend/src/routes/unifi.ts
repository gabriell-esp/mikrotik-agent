import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden } from '../lib/errors.js';
import { secretBox } from '../lib/secrets.js';
import { idParam, optionalText, parse } from '../lib/validate.js';
import type { Permission } from '../auth/permissions.js';
import { canAccessClient, requirePerm, type AuthUser } from '../auth/session.js';
import { audit } from '../services/audit.js';
import { UnifiClient, UnifiError } from '../unifi/client.js';
import { UnifiIntegrationClient } from '../unifi/integration.js';
import { capabilities, controllerSummary, dropSession, getController, readCache, refreshController, statusFromUnifiError, withController, type CacheKind, type ControllerRow } from '../unifi/service.js';

const fingerprint = z
  .string()
  .trim()
  .regex(/^([0-9a-fA-F]{2}:?){31}[0-9a-fA-F]{2}$/, 'Fingerprint SHA-256 inválido (64 dígitos hexadecimais)')
  .optional()
  .nullable()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

/** Aceita "10.0.0.5", "10.0.0.5:8443" ou URL completa; assume https. */
const urlSchema = z
  .string()
  .trim()
  .min(3, 'Informe o endereço da controladora')
  .max(300)
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`).replace(/\/+$/, ''))
  .refine((v) => {
    try {
      const u = new URL(v);
      return !!u.hostname;
    } catch {
      return false;
    }
  }, 'Endereço inválido (ex.: https://10.200.0.5 ou https://10.200.0.5:8443)');

const controllerBase = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  client_id: z.number().int().positive({ message: 'Selecione o cliente' }).nullable().default(null),
  url: urlSchema,
  auth_type: z.enum(['password', 'apikey']).default('password'),
  username: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  /** Senha (modo usuário/senha) ou API key (modo apikey). */
  password: z.string().max(500).optional(),
  tls_fingerprint: fingerprint,
  notes: optionalText(2000),
  poll_enabled: z.boolean().default(true),
});
const needsUser = (b: { auth_type: string; username: string | null }) => b.auth_type === 'apikey' || !!b.username;
const controllerSchema = controllerBase.refine(needsUser, { message: 'Informe o usuário da controladora', path: ['username'] });

const macSchema = z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, 'MAC inválido').transform((v) => v.toLowerCase());
const siteSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Site inválido');

function scopeSql(user: AuthUser, params: unknown[]): string {
  if (user.allClients) return 'TRUE';
  params.push(user.clientIds);
  return `c.client_id = ANY($${params.length}::int[])`;
}

function canAccess(user: AuthUser, c: { client_id: number | null }): boolean {
  return user.allClients || (c.client_id != null && canAccessClient(user, c.client_id));
}

async function controllerFromRequest(req: FastifyRequest, ...perms: Permission[]): Promise<{ user: AuthUser; ctrl: ControllerRow }> {
  const user = requirePerm(req, ...perms);
  const { id } = parse(idParam, req.params);
  const ctrl = await getController(id);
  if (!canAccess(user, ctrl)) throw forbidden('Você não tem acesso a esta controladora.');
  return { user, ctrl };
}

const PUBLIC_COLS = `c.id, c.client_id, c.name, c.url, c.auth_type, c.username, c.tls_fingerprint, c.platform, c.version, c.notes, c.poll_enabled,
  c.status, c.status_message, c.status_since, c.last_poll_at, c.last_ok_at, c.created_at, c.updated_at`;

async function present(id: number) {
  const row = await one(`SELECT ${PUBLIC_COLS}, cl.name AS client_name FROM unifi_controllers c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`, [id]);
  return { ...row, summary: await controllerSummary(id), capabilities: capabilities(row) };
}

/** Erros da controladora viram respostas compreensíveis. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UnifiError) throw new AppError(e.kind === 'command' ? 422 : 502, `unifi_${e.kind}`, e.message);
    throw e;
  }
}

export async function unifiRoutes(app: FastifyInstance) {
  app.get('/api/unifi/controllers', async (req) => {
    const user = requirePerm(req, 'unifi.view');
    const params: unknown[] = [];
    const rows = await query(
      `SELECT ${PUBLIC_COLS}, cl.name AS client_name FROM unifi_controllers c LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE ${scopeSql(user, params)} ORDER BY cl.name NULLS FIRST, c.name`,
      params,
    );
    return Promise.all(rows.map(async (r) => ({ ...r, summary: await controllerSummary(r.id), capabilities: capabilities(r), sync: await readCache(r.id, '', 'sites').then(({ data, ...rest }) => rest) })));
  });

  app.get('/api/unifi/controllers/:id', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.view');
    const sites = await readCache(ctrl.id, '', 'sites');
    return { ...(await present(ctrl.id)), sites: sites.data ?? [], sync: { collectedAt: sites.collectedAt, stale: sites.stale, error: sites.error } };
  });

  /** Teste de conexão somente leitura. */
  app.post('/api/unifi/test', async (req) => {
    const user = requirePerm(req, 'unifi.manage');
    const b = parse(controllerBase.pick({ url: true, auth_type: true, username: true, password: true, tls_fingerprint: true }).extend({ controller_id: z.number().int().optional() }).refine(needsUser, { message: 'Informe o usuário da controladora', path: ['username'] }), req.body);
    let password = b.password ?? '';
    if (!password && b.controller_id) {
      const c = await getController(b.controller_id);
      if (!canAccess(user, c)) throw forbidden();
      try {
        password = secretBox().decrypt(c.password_enc);
      } catch {
        throw badRequest('A senha salva não pôde ser lida com a chave mestra atual. Informe a senha novamente.');
      }
    }
    if (!password) throw badRequest(b.auth_type === 'apikey' ? 'Informe a API key.' : 'Informe a senha da controladora.');
    const api = b.auth_type === 'apikey'
      ? new UnifiIntegrationClient({ url: b.url, apiKey: password, tlsFingerprint: b.tls_fingerprint, timeoutMs: 10000 })
      : new UnifiClient({ url: b.url, username: b.username ?? '', password, tlsFingerprint: b.tls_fingerprint, timeoutMs: 10000 });
    const started = Date.now();
    try {
      let sites: { name: string; desc: string }[];
      if (api instanceof UnifiIntegrationClient) {
        await api.info();
        sites = (await api.sites()).map((s) => ({ name: s.id, desc: s.name || s.internalReference || s.id }));
      } else {
        const raw = await api.sites();
        if (raw[0]) await api.sysinfo(raw[0].name).catch(() => undefined);
        sites = raw.map((s) => ({ name: s.name, desc: s.desc || s.name }));
      }
      return {
        ok: true, ms: Date.now() - started, platform: api.platform, version: api.version, auth_type: b.auth_type, sites,
        capabilities: capabilities({ auth_type: b.auth_type, version: api.version }),
      };
    } catch (e) {
      if (!(e instanceof UnifiError)) throw e;
      return { ok: false, kind: e.kind, status: statusFromUnifiError(e), message: e.message, ms: Date.now() - started };
    } finally {
      api.close();
    }
  });

  app.post('/api/unifi/controllers', async (req) => {
    const user = requirePerm(req, 'unifi.manage');
    const b = parse(controllerSchema, req.body);
    if (!b.password) throw badRequest(b.auth_type === 'apikey' ? 'Informe a API key.' : 'Informe a senha da controladora.');
    if (b.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    if (!b.client_id && !user.allClients) throw badRequest('Selecione o cliente.');
    if (await one('SELECT 1 FROM unifi_controllers WHERE lower(url) = lower($1)', [b.url])) throw conflict('Já existe uma controladora com esse endereço.');
    const c = await one(
      `INSERT INTO unifi_controllers(client_id, name, url, auth_type, username, password_enc, tls_fingerprint, notes, poll_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, client_id`,
      [b.client_id, b.name, b.url, b.auth_type, b.auth_type === 'apikey' ? null : b.username, secretBox().encrypt(b.password), b.tls_fingerprint, b.notes, b.poll_enabled],
    );
    await audit(req, { action: 'unifi.controller.create', controller: c, target: b.url, details: { auth_type: b.auth_type, username: b.username } });
    void refreshController(await getController(c.id)).catch(() => undefined);
    return present(c.id);
  });

  app.put('/api/unifi/controllers/:id', async (req) => {
    const { user, ctrl } = await controllerFromRequest(req, 'unifi.manage');
    const b = parse(controllerSchema, req.body);
    if (b.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    if (await one('SELECT 1 FROM unifi_controllers WHERE lower(url) = lower($1) AND id <> $2', [b.url, ctrl.id])) throw conflict('Já existe uma controladora com esse endereço.');
    if (b.auth_type !== ctrl.auth_type && !b.password) throw badRequest(b.auth_type === 'apikey' ? 'Informe a API key para trocar o modo de acesso.' : 'Informe a senha para trocar o modo de acesso.');
    const connChanged = b.url !== ctrl.url || b.auth_type !== ctrl.auth_type || b.username !== ctrl.username || !!b.password || b.tls_fingerprint !== ctrl.tls_fingerprint;
    await query(
      `UPDATE unifi_controllers SET client_id=$2, name=$3, url=$4, username=$5, password_enc=$6, tls_fingerprint=$7, notes=$8, poll_enabled=$9, auth_type=$10, updated_at=now()
         ${connChanged ? ", platform = NULL, status = 'unknown', status_message = NULL" : ''}
       WHERE id=$1`,
      [ctrl.id, b.client_id, b.name, b.url, b.auth_type === 'apikey' ? null : b.username, b.password ? secretBox().encrypt(b.password) : ctrl.password_enc, b.tls_fingerprint, b.notes, b.poll_enabled, b.auth_type],
    );
    if (connChanged) dropSession(ctrl.id);
    await audit(req, { action: 'unifi.controller.update', controller: { id: ctrl.id, name: b.name, client_id: b.client_id }, target: b.url, details: { auth_type: b.auth_type, password_changed: !!b.password, url_changed: b.url !== ctrl.url } });
    if (connChanged) void refreshController(await getController(ctrl.id)).catch(() => undefined);
    return present(ctrl.id);
  });

  app.delete('/api/unifi/controllers/:id', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.manage');
    const b = parse(z.object({ confirm: z.string() }), req.body);
    if (b.confirm !== ctrl.name) throw badRequest('Digite o nome exato da controladora para confirmar a exclusão.');
    await audit(req, { action: 'unifi.controller.delete', controller: ctrl, target: ctrl.url });
    dropSession(ctrl.id);
    await query('DELETE FROM unifi_controllers WHERE id = $1', [ctrl.id]);
    return { ok: true };
  });

  /** Força nova leitura de todos os sites da controladora. */
  app.post('/api/unifi/controllers/:id/refresh', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.view');
    const r = await refreshController(ctrl);
    return { ...r, controller: await present(ctrl.id) };
  });

  /** Dados de um site (última coleta; atualiza se estiver velho ou com ?refresh=1). */
  app.get('/api/unifi/controllers/:id/sites/:site/:kind', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.view');
    const p = req.params as { site: string; kind: string };
    const site = parse(siteSchema, p.site);
    const kind = parse(z.enum(['devices', 'clients', 'wlans', 'blocked', 'health']), p.kind) as CacheKind;
    let cache = await readCache(ctrl.id, site, kind);
    const age = cache.collectedAt ? Date.now() - new Date(cache.collectedAt).getTime() : Infinity;
    if ((req.query as { refresh?: string }).refresh === '1' || age > 30_000) {
      await refreshController(ctrl);
      cache = await readCache(ctrl.id, site, kind);
    }
    const sites = await readCache(ctrl.id, '', 'sites');
    // Falha na última leitura da controladora também torna os dados do site desatualizados.
    return { rows: cache.data ?? [], collectedAt: cache.collectedAt, stale: cache.stale || !!sites.error, error: cache.error ?? sites.error, controllerStatus: ctrl.status };
  });

  // ------------------------------------------------------------ ações (sempre auditadas)

  const deviceAction = z.object({ action: z.enum(['restart', 'locate', 'unlocate', 'upgrade']), name: z.string().max(200).optional(), confirm: z.boolean().optional() });
  app.post('/api/unifi/controllers/:id/sites/:site/devices/:mac/action', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.control');
    const p = req.params as { site: string; mac: string };
    const site = parse(siteSchema, p.site);
    const mac = parse(macSchema, p.mac);
    const b = parse(deviceAction, req.body);
    if ((b.action === 'restart' || b.action === 'upgrade') && b.confirm !== true) throw badRequest('Confirme a operação.');
    const cmd = { restart: 'restart', locate: 'set-locate', unlocate: 'unset-locate', upgrade: 'upgrade' } as const;
    const target = b.name ? `${b.name} (${mac})` : mac;
    const caps = capabilities(ctrl);
    if (!caps[b.action === 'unlocate' ? 'locate' : b.action]) throw badRequest('Esta ação não está disponível no acesso por API key. Use usuário e senha para localizar ou atualizar firmware.');
    let deviceId: string | null = null;
    if (ctrl.auth_type === 'apikey') {
      const cached = await readCache(ctrl.id, site, 'devices');
      deviceId = (cached.data ?? []).find((d: any) => d.mac === mac)?.id ?? null;
      if (!deviceId) throw badRequest('Dispositivo não encontrado na última leitura. Clique em "Ler agora" e tente de novo.');
    }
    try {
      await run(() => withController(ctrl, (api) => (api instanceof UnifiIntegrationClient ? api.restartDevice(site, deviceId!) : api.deviceCmd(site, cmd[b.action], mac))));
      await audit(req, { action: `unifi.device.${b.action}`, controller: ctrl, target, details: { site, mac } });
    } catch (e) {
      await audit(req, { action: `unifi.device.${b.action}`, controller: ctrl, target, success: false, details: { site, mac, erro: (e as Error).message } });
      throw e;
    }
    setTimeout(() => void refreshController(ctrl).catch(() => undefined), 3000);
    return { ok: true };
  });

  const clientAction = z.object({ action: z.enum(['kick', 'block', 'unblock']), name: z.string().max(200).optional(), confirm: z.boolean().optional() });
  app.post('/api/unifi/controllers/:id/sites/:site/clients/:mac/action', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.control');
    const p = req.params as { site: string; mac: string };
    const site = parse(siteSchema, p.site);
    const mac = parse(macSchema, p.mac);
    const b = parse(clientAction, req.body);
    if (b.action === 'block' && b.confirm !== true) throw badRequest('Confirme o bloqueio.');
    const cmd = { kick: 'kick-sta', block: 'block-sta', unblock: 'unblock-sta' } as const;
    const target = b.name ? `${b.name} (${mac})` : mac;
    if (ctrl.auth_type === 'apikey') throw badRequest('Reconectar e bloquear clientes não estão disponíveis na API oficial (API key). Use o acesso por usuário e senha.');
    try {
      await run(() => withController(ctrl, (api) => (api as UnifiClient).clientCmd(site, cmd[b.action], mac)));
      await audit(req, { action: `unifi.client.${b.action}`, controller: ctrl, target, details: { site, mac } });
    } catch (e) {
      await audit(req, { action: `unifi.client.${b.action}`, controller: ctrl, target, success: false, details: { site, mac, erro: (e as Error).message } });
      throw e;
    }
    void refreshController(ctrl).catch(() => undefined);
    return { ok: true };
  });

  app.put('/api/unifi/controllers/:id/sites/:site/wlans/:wlanId', async (req) => {
    const { ctrl } = await controllerFromRequest(req, 'unifi.control');
    const p = req.params as { site: string; wlanId: string };
    const site = parse(siteSchema, p.site);
    const wlanId = parse(z.string().regex(/^[0-9a-f-]{24,36}$/i, 'Rede inválida'), p.wlanId);
    const b = parse(z.object({ enabled: z.boolean(), name: z.string().max(100).optional() }), req.body);
    const action = b.enabled ? 'unifi.wlan.enable' : 'unifi.wlan.disable';
    try {
      await run(() => withController(ctrl, async (api) => {
        if (!(api instanceof UnifiIntegrationClient)) return api.setWlanEnabled(site, wlanId, b.enabled);
        // Integration API: o PUT exige o objeto completo; lê o atual e altera apenas "enabled".
        const { id: _id, metadata: _m, ...current } = await api.wifiBroadcast(site, wlanId);
        return api.updateWifiBroadcast(site, wlanId, { ...current, enabled: b.enabled });
      }));
      await audit(req, { action, controller: ctrl, target: b.name ?? wlanId, details: { site } });
    } catch (e) {
      await audit(req, { action, controller: ctrl, target: b.name ?? wlanId, success: false, details: { site, erro: (e as Error).message } });
      throw e;
    }
    void refreshController(ctrl).catch(() => undefined);
    return { ok: true };
  });
}
