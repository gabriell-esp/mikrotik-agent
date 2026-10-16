import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db/pool.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { secretBox } from '../lib/secrets.js';
import { hostSchema, optionalText, parse } from '../lib/validate.js';
import { canAccessClient, deviceScopeSql, hasPerm, requirePerm } from '../auth/session.js';
import { getModule, MODULES } from '../modules/registry.js';
import { openClient } from '../routeros/manager.js';
import { RosError, type DeviceConnInfo } from '../routeros/types.js';
import { deviceFromRequest } from '../services/access.js';
import { audit } from '../services/audit.js';
import { getDeviceRow, runOnDevice, statusFromError } from '../services/devices.js';
import { filterLogs } from '../services/logs.js';
import { loadModule } from '../services/module-cache.js';
import { peerState } from '../services/wireguard.js';

const port = z.coerce.number().int().min(1).max(65535);
const fingerprint = z
  .string()
  .trim()
  .regex(/^([0-9a-fA-F]{2}:?){31}[0-9a-fA-F]{2}$/, 'Fingerprint SHA-256 inválido (64 dígitos hexadecimais)')
  .optional()
  .nullable()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const connFields = {
  host: hostSchema,
  api_method: z.enum(['auto', 'api-ssl', 'rest', 'api']).default('auto'),
  api_ssl_port: port.default(8729),
  rest_port: port.default(443),
  api_port: port.default(8728),
  allow_plaintext: z.boolean().default(false),
  tls_fingerprint: fingerprint,
  username: z.string().trim().min(1, 'Informe o usuário do roteador').max(100),
};

const deviceSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(120),
    client_id: z.number().int().positive().nullable().default(null),
    is_central: z.boolean().default(false),
    ...connFields,
    password: z.string().max(200).optional(),
    notes: optionalText(2000),
    poll_enabled: z.boolean().default(true),
    wg_peer_id: z.number().int().positive().optional(),
  })
  .refine((d) => d.is_central || d.client_id != null, { message: 'Selecione o cliente', path: ['client_id'] })
  .refine((d) => d.api_method !== 'api' || d.allow_plaintext, {
    message: 'Para usar a API sem criptografia, marque "permitir conexão sem TLS"',
    path: ['allow_plaintext'],
  });

export const DEVICE_COLUMNS = `d.id, d.client_id, d.name, d.is_central, d.host, d.api_method, d.api_ssl_port, d.rest_port, d.api_port,
  d.allow_plaintext, d.tls_fingerprint, d.username, d.notes, d.poll_enabled, d.status, d.status_message, d.detected_method,
  d.ros_version, d.board_name, d.identity, d.last_poll_at, d.last_ok_at, d.created_at, d.updated_at`;

const LIST_SQL = `SELECT ${DEVICE_COLUMNS}, c.name AS client_name,
    p.id AS peer_id, p.name AS peer_name, p.comment AS peer_comment, p.last_handshake_seconds, p.disabled AS peer_disabled,
    p.collected_at AS peer_collected_at, p.present AS peer_present
  FROM devices d
  LEFT JOIN clients c ON c.id = d.client_id
  LEFT JOIN LATERAL (SELECT * FROM wg_peers WHERE device_id = d.id ORDER BY present DESC, id LIMIT 1) p ON TRUE`;

function present(r: any) {
  const { last_handshake_seconds, peer_disabled, peer_collected_at, ...rest } = r;
  return {
    ...rest,
    peer_state: r.peer_id ? peerState({ disabled: peer_disabled, last_handshake_seconds, collected_at: peer_collected_at }) : null,
    peer_last_handshake_seconds: last_handshake_seconds ?? null,
    peer_collected_at: peer_collected_at ?? null,
  };
}

export async function deviceRoutes(app: FastifyInstance) {
  app.get('/api/devices', async (req) => {
    const user = requirePerm(req, 'devices.view');
    const q = parse(
      z.object({ search: z.string().optional(), client_id: z.coerce.number().int().optional(), status: z.string().optional() }),
      req.query,
    );
    const params: unknown[] = [];
    const where = [deviceScopeSql(user, 'd', params)];
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(d.name ILIKE $${params.length} OR d.host ILIKE $${params.length} OR c.name ILIKE $${params.length} OR d.identity ILIKE $${params.length})`);
    }
    if (q.client_id) {
      params.push(q.client_id);
      where.push(`d.client_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`d.status = $${params.length}`);
    }
    return (await query(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY d.is_central DESC, c.name NULLS FIRST, d.name`, params)).map(present);
  });

  app.get('/api/devices/:id', async (req) => {
    const { user, device } = await deviceFromRequest(req, 'devices.view');
    const row = present(await one(`${LIST_SQL} WHERE d.id = $1`, [device.id]));
    const events = await query('SELECT at, status, message FROM device_status_events WHERE device_id = $1 ORDER BY at DESC LIMIT 20', [device.id]);
    const modules = MODULES.filter((m) => hasPerm(user, m.permission) && !(m.key === 'ppp' && device.is_central)).map((m) => ({ key: m.key, label: m.label }));
    return { ...row, events, modules };
  });

  /** Teste de conexão somente leitura (não altera nada no roteador). */
  app.post('/api/devices/test', async (req) => {
    const user = requirePerm(req, 'devices.manage');
    const b = parse(z.object({ ...connFields, password: z.string().max(200).optional(), device_id: z.number().int().optional() }), req.body);
    let password = b.password ?? '';
    let detected: string | null = null;
    if (!password && b.device_id) {
      const d = await getDeviceRow(b.device_id);
      if (!user.allClients && (d.is_central || !d.client_id || !canAccessClient(user, d.client_id))) throw forbidden();
      password = secretBox().decrypt(d.password_enc);
      detected = d.detected_method;
    }
    if (!password) throw badRequest('Informe a senha do roteador.');
    const info: DeviceConnInfo = { id: 0, name: 'teste', ...b, password, detected_method: detected };
    const started = Date.now();
    try {
      const { client, method, attempts } = await openClient(info);
      try {
        const [res] = await client.print('/system/resource');
        const [idt] = await client.print('/system/identity');
        return {
          ok: true, method, attempts, ms: Date.now() - started,
          version: res?.version ?? null, board: res?.['board-name'] ?? null, identity: idt?.name ?? null,
        };
      } finally {
        client.close();
      }
    } catch (e) {
      if (!(e instanceof RosError)) throw e;
      return { ok: false, kind: e.kind, status: statusFromError(e), message: e.message, attempts: (e as any).attempts ?? [], ms: Date.now() - started };
    }
  });

  app.post('/api/devices', async (req) => {
    const user = requirePerm(req, 'devices.manage');
    const b = parse(deviceSchema, req.body);
    if (!b.password) throw badRequest('Informe a senha do roteador.');
    if (b.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    if (b.is_central && (await one('SELECT 1 FROM devices WHERE is_central'))) throw conflict('Já existe uma MikroTik central cadastrada.');
    if (await one('SELECT 1 FROM devices WHERE host = $1 AND api_ssl_port = $2 AND rest_port = $3 AND api_port = $4', [b.host, b.api_ssl_port, b.rest_port, b.api_port])) {
      throw conflict('Já existe um equipamento com esse endereço e portas.');
    }
    const created = await tx(async (db) => {
      const r = await db.query(
        `INSERT INTO devices(client_id, name, is_central, host, api_method, api_ssl_port, rest_port, api_port, allow_plaintext,
            tls_fingerprint, username, password_enc, notes, poll_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, name, client_id`,
        [b.client_id, b.name, b.is_central, b.host, b.api_method, b.api_ssl_port, b.rest_port, b.api_port,
         b.allow_plaintext, b.tls_fingerprint, b.username, secretBox().encrypt(b.password!), b.notes, b.poll_enabled],
      );
      const dev = r.rows[0];
      if (b.wg_peer_id) await db.query('UPDATE wg_peers SET device_id = $2 WHERE id = $1', [b.wg_peer_id, dev.id]);
      return dev;
    });
    await audit(req, {
      action: 'device.create', device: created, target: b.host,
      details: { is_central: b.is_central, api_method: b.api_method, username: b.username, wg_peer_id: b.wg_peer_id ?? null },
    });
    return present(await one(`${LIST_SQL} WHERE d.id = $1`, [created.id]));
  });

  app.put('/api/devices/:id', async (req) => {
    const { user, device } = await deviceFromRequest(req, 'devices.manage');
    const b = parse(deviceSchema, req.body);
    if (b.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    if (b.is_central && (await one('SELECT 1 FROM devices WHERE is_central AND id <> $1', [device.id]))) throw conflict('Já existe uma MikroTik central cadastrada.');
    if (await one('SELECT 1 FROM devices WHERE host = $1 AND api_ssl_port = $2 AND rest_port = $3 AND api_port = $4 AND id <> $5', [b.host, b.api_ssl_port, b.rest_port, b.api_port, device.id])) {
      throw conflict('Já existe um equipamento com esse endereço e portas.');
    }
    const pwEnc = b.password ? secretBox().encrypt(b.password) : device.password_enc;
    const connChanged = b.host !== device.host || b.username !== device.username || !!b.password || b.api_method !== device.api_method;
    await query(
      `UPDATE devices SET client_id=$2, name=$3, is_central=$4, host=$5, api_method=$6, api_ssl_port=$7, rest_port=$8, api_port=$9,
         allow_plaintext=$10, tls_fingerprint=$11, username=$12, password_enc=$13, notes=$14, poll_enabled=$15, updated_at=now()
         ${connChanged ? ", detected_method = NULL, status = 'unknown', status_message = NULL" : ''}
       WHERE id=$1`,
      [device.id, b.client_id, b.name, b.is_central, b.host, b.api_method, b.api_ssl_port, b.rest_port, b.api_port,
       b.allow_plaintext, b.tls_fingerprint, b.username, pwEnc, b.notes, b.poll_enabled],
    );
    await audit(req, {
      action: 'device.update', device: { id: device.id, name: b.name, client_id: b.client_id }, target: b.host,
      details: { password_changed: !!b.password, api_method: b.api_method, username: b.username, host_changed: b.host !== device.host },
    });
    return present(await one(`${LIST_SQL} WHERE d.id = $1`, [device.id]));
  });

  app.delete('/api/devices/:id', async (req) => {
    const { device } = await deviceFromRequest(req, 'devices.manage');
    const b = parse(z.object({ confirm: z.string() }), req.body);
    if (b.confirm !== device.name) throw badRequest('Digite o nome exato do equipamento para confirmar a exclusão.');
    // Registrado antes da exclusão: o vínculo vira NULL, mas o nome do equipamento fica no histórico.
    await audit(req, { action: 'device.delete', device, target: `${device.name} (${device.host})` });
    await query('DELETE FROM devices WHERE id = $1', [device.id]);
    return { ok: true };
  });

  /** Força uma nova tentativa de conexão e atualiza o status de gerência. */
  app.post('/api/devices/:id/check', async (req) => {
    const { device } = await deviceFromRequest(req, 'devices.view');
    await loadModule(device, getModule('system')!, true);
    const d = await one('SELECT status, status_message, detected_method, ros_version, last_poll_at, last_ok_at FROM devices WHERE id = $1', [device.id]);
    return d;
  });

  app.get('/api/devices/:id/modules/:key', async (req) => {
    const key = (req.params as { key: string }).key;
    const m = getModule(key);
    if (!m) throw badRequest('Módulo inexistente.');
    const { device } = await deviceFromRequest(req, m.permission);
    if (m.key === 'ppp' && device.is_central) throw badRequest('A MikroTik central não é gerenciada como servidor PPPoE.');
    const refresh = (req.query as { refresh?: string }).refresh === '1';
    const data = await loadModule(device, m, refresh);
    if (m.key === 'firewall') await audit(req, { action: 'monitor.firewall.view', device });
    return data;
  });

  app.get('/api/devices/:id/logs', async (req) => {
    const { device } = await deviceFromRequest(req, 'logs.view');
    const q = parse(
      z.object({
        topic: z.string().max(50).optional(),
        q: z.string().max(200).optional(),
        from: z.string().max(20).optional(),
        to: z.string().max(20).optional(),
        refresh: z.string().optional(),
      }),
      req.query,
    );
    const data = await loadModule(device, getModule('logs')!, q.refresh === '1');
    const log = data.sections.find((s) => s.key === 'log')!;
    const clock = data.sections.find((s) => s.key === 'clock');
    const meta = { collectedAt: data.collectedAt, stale: data.stale, error: data.error, deviceStatus: data.deviceStatus };
    if (!log.ok) return { ...meta, available: false, reason: log.reason, rows: [], topics: [] };
    return { ...meta, available: true, ...filterLogs(log.rows, clock?.ok ? clock.rows[0] : undefined, q) };
  });

  /** Tráfego instantâneo (monitor-traffic once). Não é armazenado em cache. */
  app.get('/api/devices/:id/traffic', async (req) => {
    const { device } = await deviceFromRequest(req, 'monitor.view');
    const q = parse(z.object({ interfaces: z.string().min(1).max(500) }), req.query);
    const names = q.interfaces.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (names.some((n) => /[\s,]/.test(n) || n.length > 64)) throw badRequest('Nome de interface inválido.');
    const rows = await runOnDevice(device, (c) => c.command('/interface', 'monitor-traffic', { interface: names.join(','), once: '' }));
    return {
      collectedAt: new Date().toISOString(),
      rows: rows.map((r) => ({
        name: r.name,
        rxBps: Number(r['rx-bits-per-second'] ?? 0),
        txBps: Number(r['tx-bits-per-second'] ?? 0),
        rxPps: Number(r['rx-packets-per-second'] ?? 0),
        txPps: Number(r['tx-packets-per-second'] ?? 0),
      })),
    };
  });
}

