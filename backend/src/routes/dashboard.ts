import type { FastifyInstance } from 'fastify';
import { query, one } from '../db/pool.js';
import { deviceScopeSql, hasPerm, requirePerm } from '../auth/session.js';
import { collectorState } from '../services/collector.js';
import { getCentral, peerState, WG_CACHE_MODULE } from '../services/wireguard.js';

const STATUS_LABEL: Record<string, string> = {
  unreachable: 'inacessível',
  auth_failed: 'falha de autenticação',
  error: 'erro de comunicação',
};

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const user = requirePerm(req, 'dashboard.view');
    const params: unknown[] = [];
    const scope = deviceScopeSql(user, 'd', params);
    const devices = await query(
      `SELECT d.id, d.name, d.status, d.status_message, d.last_ok_at, d.last_poll_at, d.client_id, d.is_central, c.name AS client_name,
              mc.data->'sections'->'resource'->'rows'->0 AS resource
         FROM devices d LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN module_cache mc ON mc.device_id = d.id AND mc.module = 'system'
        WHERE ${scope}`,
      params,
    );
    const counts = { total: devices.length, online: 0, unreachable: 0, auth_failed: 0, error: 0, unknown: 0 };
    const alerts: { level: 'error' | 'warning'; message: string; device_id?: number; at?: string }[] = [];
    for (const d of devices) {
      counts[d.status as keyof typeof counts]++;
      if (STATUS_LABEL[d.status]) {
        alerts.push({ level: d.status === 'unreachable' ? 'error' : 'warning', device_id: d.id, at: d.last_poll_at,
          message: `${d.name}${d.client_name ? ` (${d.client_name})` : ''}: ${STATUS_LABEL[d.status]}${d.status_message ? ` — ${d.status_message}` : ''}` });
      }
      const r = d.resource;
      if (d.status === 'online' && r) {
        const cpu = Number(r['cpu-load']);
        const memPct = 100 - (Number(r['free-memory']) / Number(r['total-memory'])) * 100;
        const hddPct = 100 - (Number(r['free-hdd-space']) / Number(r['total-hdd-space'])) * 100;
        if (cpu >= 90) alerts.push({ level: 'warning', device_id: d.id, message: `${d.name}: CPU em ${cpu}%` });
        if (memPct >= 90) alerts.push({ level: 'warning', device_id: d.id, message: `${d.name}: memória em ${memPct.toFixed(0)}%` });
        if (hddPct >= 90) alerts.push({ level: 'warning', device_id: d.id, message: `${d.name}: armazenamento em ${hddPct.toFixed(0)}%` });
      }
    }

    let wireguard = null;
    if (hasPerm(user, 'wireguard.view')) {
      const central = await getCentral();
      if (central) {
        const peers = await query('SELECT disabled, last_handshake_seconds, collected_at, device_id, present FROM wg_peers WHERE central_device_id = $1', [central.id]);
        const sync = await one('SELECT collected_at, last_error, last_error_at FROM module_cache WHERE device_id = $1 AND module = $2', [central.id, WG_CACHE_MODULE]);
        const summary = { total: 0, recent: 0, stale: 0, never: 0, disabled: 0, unlinked: 0, removed: 0 };
        for (const p of peers) {
          if (!p.present) { summary.removed++; continue; }
          summary.total++;
          summary[peerState(p)]++;
          if (!p.device_id) summary.unlinked++;
        }
        const syncFailed = !!sync?.last_error_at && (!sync.collected_at || sync.last_error_at > sync.collected_at);
        if (syncFailed) alerts.unshift({ level: 'error', message: `Falha ao consultar a MikroTik central: ${sync.last_error}`, at: sync.last_error_at });
        wireguard = { central: { id: central.id, name: central.name, status: central.status }, summary, collectedAt: sync?.collected_at ?? null, error: syncFailed ? sync.last_error : null };
      }
    }

    const lastPoll = devices.reduce<string | null>((acc, d) => (d.last_poll_at && (!acc || d.last_poll_at > acc) ? d.last_poll_at : acc), null);
    return {
      counts,
      wireguard,
      alerts,
      lastDevicePollAt: lastPoll,
      collector: { lastDeviceRunAt: collectorState.lastDeviceRunAt, lastWgRunAt: collectorState.lastWgRunAt },
      generatedAt: new Date().toISOString(),
    };
  });
}
