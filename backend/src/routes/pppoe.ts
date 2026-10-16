import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { AppError, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { deviceScopeSql, requirePerm } from '../auth/session.js';
import { getModule } from '../modules/registry.js';
import { RosError, type RosRecord } from '../routeros/types.js';
import { toBool } from '../routeros/parse.js';
import { deviceFromRequest } from '../services/access.js';
import { audit } from '../services/audit.js';
import { runOnDevice, type DeviceRow } from '../services/devices.js';
import { loadModule, refreshModule } from '../services/module-cache.js';
import {
  createSecret, createSecretSchema, diffForAudit, findSecret, refreshPppCache, rosIdSchema, updateSecret, updateSecretSchema,
} from '../services/pppoe.js';

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  device_id: z.coerce.number().int().optional(),
  client_id: z.coerce.number().int().optional(),
  status: z.enum(['enabled', 'disabled', 'connected', 'disconnected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(10).max(200).default(50),
});

interface CacheJoin {
  device_id: number;
  device_name: string;
  client_id: number | null;
  client_name: string | null;
  device_status: string;
  collected_at: Date | null;
  last_error: string | null;
  last_error_at: Date | null;
  host: string;
  status_message: string | null;
  last_ok_at: Date | null;
  ros_version: string | null;
  identity: string | null;
  servers: { ok: boolean; rows?: RosRecord[]; reason?: string } | null;
  secrets: { ok: boolean; rows?: RosRecord[]; reason?: string } | null;
  active: { ok: boolean; rows?: RosRecord[]; reason?: string } | null;
}

/** Lê o cache PPP dos equipamentos acessíveis (coletado periodicamente) para busca global. */
async function pppCaches(req: FastifyRequest, deviceId?: number, clientId?: number): Promise<CacheJoin[]> {
  const user = requirePerm(req, 'pppoe.view');
  const params: unknown[] = [];
  // PPPoE é gerenciado nas MikroTiks dos clientes (condomínios); a central não é servidor PPPoE.
  const where = [deviceScopeSql(user, 'd', params), 'NOT d.is_central'];
  if (deviceId) {
    params.push(deviceId);
    where.push(`d.id = $${params.length}`);
  }
  if (clientId) {
    params.push(clientId);
    where.push(`d.client_id = $${params.length}`);
  }
  return query<CacheJoin>(
    `SELECT d.id AS device_id, d.name AS device_name, d.host, d.client_id, c.name AS client_name, d.status AS device_status,
            d.status_message, d.last_ok_at, d.ros_version, d.identity,
            mc.collected_at, mc.last_error, mc.last_error_at,
            mc.data->'sections'->'secrets' AS secrets, mc.data->'sections'->'active' AS active,
            mc.data->'sections'->'servers' AS servers
       FROM devices d
       LEFT JOIN clients c ON c.id = d.client_id
       LEFT JOIN module_cache mc ON mc.device_id = d.id AND mc.module = 'ppp'
      WHERE ${where.join(' AND ')}`,
    params,
  );
}

function freshness(c: CacheJoin) {
  const failed = !!c.last_error_at && (!c.collected_at || c.last_error_at > c.collected_at);
  const old = !!c.collected_at && Date.now() - new Date(c.collected_at).getTime() > config.pollIntervalSec * 2500;
  return { collectedAt: c.collected_at, stale: failed || old || !c.collected_at, error: failed ? c.last_error : null };
}

function paginate<T>(rows: T[], page: number, size: number) {
  return { total: rows.length, page, page_size: size, rows: rows.slice((page - 1) * size, page * size) };
}

/** Executa uma alteração PPP, auditando sucesso e falha (sem senhas). */
async function mutate<T>(
  req: FastifyRequest,
  device: DeviceRow,
  action: string,
  target: string,
  fn: (c: Parameters<Parameters<typeof runOnDevice>[1]>[0]) => Promise<{ result: T; details?: Record<string, unknown> }>,
): Promise<T> {
  try {
    const out = await runOnDevice(device, async (c) => {
      const r = await fn(c);
      await refreshPppCache(c, device.id).catch(() => undefined);
      return r;
    });
    await audit(req, { action, device, target, details: out.details ?? null });
    return out.result;
  } catch (e) {
    const message = e instanceof RosError || e instanceof AppError ? e.message : 'erro interno';
    await audit(req, { action, device, target, success: false, details: { erro: message } });
    throw e;
  }
}

/** Equipamento da rota para operações PPPoE: aplica permissões, escopo e exclui a central. */
async function pppDevice(req: FastifyRequest, ...perms: Parameters<typeof deviceFromRequest>[1][]) {
  const r = await deviceFromRequest(req, ...perms);
  if (r.device.is_central) throw badRequest('A MikroTik central não é gerenciada como servidor PPPoE. Selecione a MikroTik do cliente.');
  return r;
}

const confirmBody = z.object({ expected_name: z.string().min(1), confirm: z.string() });

export async function pppoeRoutes(app: FastifyInstance) {
  /** MikroTiks de clientes com o resumo PPPoE de cada uma (dados da última coleta). */
  app.get('/api/pppoe/devices', async (req) => {
    const caches = await pppCaches(req);
    return caches
      .map((c) => {
        const secrets = c.secrets?.ok ? c.secrets.rows! : [];
        const active = c.active?.ok ? c.active.rows! : [];
        const servers = c.servers?.ok ? c.servers.rows! : [];
        const online = new Set(active.map((a) => a.name));
        return {
          device_id: c.device_id, device_name: c.device_name, host: c.host, identity: c.identity, ros_version: c.ros_version,
          client_id: c.client_id, client_name: c.client_name, device_status: c.device_status, status_message: c.status_message,
          last_ok_at: c.last_ok_at, ...freshness(c),
          collected: !!c.collected_at,
          has_pppoe: servers.length > 0 || secrets.length > 0,
          servers: servers.filter((s) => !toBool(s.disabled)).map((s) => s.interface).filter(Boolean),
          secrets_total: secrets.length,
          secrets_disabled: secrets.filter((s) => toBool(s.disabled)).length,
          online: active.filter((a) => a.service === 'pppoe' || !a.service).length,
          offline: secrets.filter((s) => !toBool(s.disabled) && !online.has(s.name)).length,
          unavailable: c.secrets && !c.secrets.ok ? c.secrets.reason : null,
        };
      })
      .sort((a, b) => Number(b.has_pppoe) - Number(a.has_pppoe) || (a.client_name ?? '').localeCompare(b.client_name ?? '', 'pt-BR') || a.device_name.localeCompare(b.device_name, 'pt-BR'));
  });

  /** Busca global de secrets em todos os equipamentos acessíveis (dados do cache). */
  app.get('/api/pppoe/secrets', async (req) => {
    const q = parse(listQuery, req.query);
    const caches = await pppCaches(req, q.device_id, q.client_id);
    const term = q.search?.toLowerCase();
    const rows = [];
    const devices = [];
    for (const c of caches) {
      const f = freshness(c);
      devices.push({ device_id: c.device_id, device_name: c.device_name, client_name: c.client_name, device_status: c.device_status, ...f,
        unavailable: c.secrets && !c.secrets.ok ? c.secrets.reason : null });
      if (!c.secrets?.ok) continue;
      const online = new Set((c.active?.ok ? c.active.rows! : []).map((a) => a.name));
      for (const s of c.secrets.rows!) {
        const disabled = toBool(s.disabled);
        const connected = online.has(s.name);
        if (q.status === 'enabled' && disabled) continue;
        if (q.status === 'disabled' && !disabled) continue;
        if (q.status === 'connected' && !connected) continue;
        if (q.status === 'disconnected' && connected) continue;
        if (term) {
          const hay = [s.name, s.comment, s.profile, s['remote-address'], s['caller-id'], c.device_name, c.client_name].join(' ').toLowerCase();
          if (!hay.includes(term)) continue;
        }
        rows.push({
          id: s['.id'], name: s.name, service: s.service, profile: s.profile, local_address: s['local-address'] ?? '',
          remote_address: s['remote-address'] ?? '', caller_id: s['caller-id'] ?? '', comment: s.comment ?? '', disabled, connected,
          last_logged_out: s['last-logged-out'] ?? null, last_caller_id: s['last-caller-id'] ?? null,
          device_id: c.device_id, device_name: c.device_name, client_id: c.client_id, client_name: c.client_name, stale: f.stale,
        });
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    return { ...paginate(rows, q.page, q.page_size), devices };
  });

  app.get('/api/pppoe/active', async (req) => {
    const q = parse(listQuery, req.query);
    const caches = await pppCaches(req, q.device_id, q.client_id);
    const term = q.search?.toLowerCase();
    const rows = [];
    for (const c of caches) {
      if (!c.active?.ok) continue;
      const f = freshness(c);
      for (const a of c.active.rows!) {
        if (term && ![a.name, a.address, a['caller-id'], c.device_name, c.client_name].join(' ').toLowerCase().includes(term)) continue;
        rows.push({
          id: a['.id'], name: a.name, service: a.service, address: a.address, caller_id: a['caller-id'], uptime: a.uptime,
          encoding: a.encoding, session_id: a['session-id'], limit_bytes_in: a['limit-bytes-in'], limit_bytes_out: a['limit-bytes-out'],
          device_id: c.device_id, device_name: c.device_name, client_id: c.client_id, client_name: c.client_name,
          collectedAt: f.collectedAt, stale: f.stale,
        });
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    return paginate(rows, q.page, q.page_size);
  });

  /** Atualiza o cache PPP sob demanda (um equipamento ou todos os acessíveis). */
  app.post('/api/pppoe/refresh', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ device_id: z.number().int().optional() }), req.body);
    const caches = await pppCaches(req, b.device_id);
    const devices = await query<DeviceRow>('SELECT * FROM devices WHERE id = ANY($1::int[])', [caches.map((c) => c.device_id)]);
    await Promise.all(devices.map((d) => refreshModule(d, getModule('ppp')!)));
    return { ok: true, devices: devices.length };
  });

  /** Profiles do equipamento, para o formulário de cadastro. */
  app.get('/api/devices/:id/pppoe/profiles', async (req) => {
    const { device } = await pppDevice(req, 'pppoe.view');
    const data = await loadModule(device, getModule('ppp')!, (req.query as { refresh?: string }).refresh === '1');
    const p = data.sections.find((s) => s.key === 'profiles')!;
    return {
      collectedAt: data.collectedAt, stale: data.stale, error: data.error,
      available: p.ok, reason: p.ok ? null : p.reason,
      profiles: p.ok
        ? p.rows.map((r) => ({ name: r.name, local_address: r['local-address'] ?? '', remote_address: r['remote-address'] ?? '', rate_limit: r['rate-limit'] ?? '', default: r.default === 'true' }))
        : [],
    };
  });

  app.post('/api/devices/:id/pppoe/secrets', async (req) => {
    const { device } = await pppDevice(req, 'pppoe.create');
    const b = parse(createSecretSchema, req.body);
    const id = await mutate(req, device, 'pppoe.secret.create', b.name, async (c) => ({
      result: await createSecret(c, b),
      details: { profile: b.profile, service: b.service, remote_address: b.remote_address, local_address: b.local_address, comment: b.comment, disabled: b.disabled },
    }));
    return { ok: true, id };
  });

  app.put('/api/devices/:id/pppoe/secrets/:rosId', async (req) => {
    const { device } = await pppDevice(req, 'pppoe.edit');
    const rosId = parse(rosIdSchema, (req.params as { rosId: string }).rosId);
    const b = parse(updateSecretSchema, req.body);
    const before = await mutate(req, device, 'pppoe.secret.update', b.expected_name, async (c) => {
      const r = await updateSecret(c, rosId, b);
      const after: Record<string, string> = {
        name: b.name, profile: b.profile, service: b.service, 'local-address': b.local_address, 'remote-address': b.remote_address,
        'caller-id': b.caller_id, comment: b.comment, disabled: b.disabled ? 'yes' : 'no',
      };
      return { result: r.before, details: diffForAudit(r.before, after, r.changed) };
    });
    return { ok: true, before };
  });

  app.post('/api/devices/:id/pppoe/secrets/:rosId/toggle', async (req) => {
    const b = parse(z.object({ expected_name: z.string().min(1), disabled: z.boolean(), disconnect: z.boolean().default(false) }), req.body);
    const { device } = await pppDevice(req, 'pppoe.toggle', ...(b.disconnect ? (['pppoe.disconnect'] as const) : []));
    const rosId = parse(rosIdSchema, (req.params as { rosId: string }).rosId);
    let disconnected = 0;
    await mutate(req, device, b.disabled ? 'pppoe.secret.disable' : 'pppoe.secret.enable', b.expected_name, async (c) => {
      await findSecret(c, b.expected_name, rosId);
      await c.set('/ppp/secret', rosId, { disabled: b.disabled ? 'yes' : 'no' });
      if (b.disabled && b.disconnect) {
        for (const a of await c.print('/ppp/active', { where: { name: b.expected_name } })) {
          await c.remove('/ppp/active', a['.id']);
          disconnected++;
        }
      }
      return { result: null, details: { disconnected } };
    });
    return { ok: true, disconnected };
  });

  app.delete('/api/devices/:id/pppoe/secrets/:rosId', async (req) => {
    const { device } = await pppDevice(req, 'pppoe.delete');
    const rosId = parse(rosIdSchema, (req.params as { rosId: string }).rosId);
    const b = parse(confirmBody, req.body);
    if (b.confirm !== b.expected_name) throw badRequest('Digite o nome do usuário exatamente para confirmar a exclusão.');
    await mutate(req, device, 'pppoe.secret.delete', b.expected_name, async (c) => {
      const s = await findSecret(c, b.expected_name, rosId);
      await c.remove('/ppp/secret', rosId);
      return { result: null, details: { profile: s.profile, comment: s.comment ?? '', remote_address: s['remote-address'] ?? '' } };
    });
    return { ok: true };
  });

  /** Revela a senha de um secret. Permissão específica e registro obrigatório em auditoria. */
  app.post('/api/devices/:id/pppoe/secrets/:rosId/password', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { device } = await pppDevice(req, 'pppoe.view', 'pppoe.password');
    const rosId = parse(rosIdSchema, (req.params as { rosId: string }).rosId);
    const b = parse(z.object({ expected_name: z.string().min(1) }), req.body);
    try {
      const pw = await runOnDevice(device, async (c) => (await findSecret(c, b.expected_name, rosId)).password ?? '');
      await audit(req, { action: 'pppoe.password.view', device, target: b.expected_name });
      return { password: pw };
    } catch (e) {
      await audit(req, { action: 'pppoe.password.view', device, target: b.expected_name, success: false, details: { erro: (e as Error).message } });
      throw e;
    }
  });

  app.delete('/api/devices/:id/pppoe/active/:rosId', async (req) => {
    const { device } = await pppDevice(req, 'pppoe.disconnect');
    const rosId = parse(rosIdSchema, (req.params as { rosId: string }).rosId);
    const b = parse(confirmBody, req.body);
    if (b.confirm !== b.expected_name) throw badRequest('Digite o nome do usuário exatamente para confirmar a desconexão.');
    await mutate(req, device, 'pppoe.session.disconnect', b.expected_name, async (c) => {
      const rows = await c.print('/ppp/active', { where: { name: b.expected_name } });
      const s = rows.find((r) => r['.id'] === rosId);
      if (!s) throw new AppError(404, 'not_found', 'A sessão não está mais ativa. Atualize a lista.');
      await c.remove('/ppp/active', rosId);
      return { result: null, details: { address: s.address, caller_id: s['caller-id'], uptime: s.uptime } };
    });
    return { ok: true };
  });
}
