import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { forbidden, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { canAccessDevice, requirePerm } from '../auth/session.js';
import { audit } from '../services/audit.js';
import { getCentral, peerState, suggestHost, syncCentralPeers, WG_CACHE_MODULE } from '../services/wireguard.js';

export async function wireguardRoutes(app: FastifyInstance) {
  app.get('/api/wireguard/peers', async (req) => {
    requirePerm(req, 'wireguard.view');
    const central = await getCentral();
    if (!central) return { central: null, peers: [], sync: null };
    const peers = await query(
      `SELECT p.*, d.name AS device_name, d.status AS device_status, d.status_message AS device_status_message,
              d.last_ok_at AS device_last_ok_at, c.id AS client_id, c.name AS client_name
         FROM wg_peers p
         LEFT JOIN devices d ON d.id = p.device_id
         LEFT JOIN clients c ON c.id = d.client_id
        WHERE p.central_device_id = $1
        ORDER BY p.present DESC, COALESCE(p.name, p.comment, p.allowed_address)`,
      [central.id],
    );
    const sync = await one(
      'SELECT data, collected_at, last_error, last_error_at FROM module_cache WHERE device_id = $1 AND module = $2',
      [central.id, WG_CACHE_MODULE],
    );
    return {
      central: { id: central.id, name: central.name, host: central.host, status: central.status, ros_version: central.ros_version },
      sync: sync && {
        collectedAt: sync.collected_at,
        error: sync.last_error,
        errorAt: sync.last_error_at,
        stale: !!sync.last_error_at && (!sync.collected_at || sync.last_error_at > sync.collected_at),
        interfaces: sync.data?.interfaces ?? [],
      },
      peers: peers.map((p) => ({ ...p, state: peerState(p), suggested_host: suggestHost(p.allowed_address) })),
    };
  });

  app.post('/api/wireguard/sync', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    requirePerm(req, 'wireguard.view');
    return syncCentralPeers();
  });

  /** Vincula (ou desvincula) um peer a um equipamento cadastrado. Não altera o roteador. */
  app.put('/api/wireguard/peers/:id/link', async (req) => {
    const user = requirePerm(req, 'wireguard.view', 'wireguard.link');
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ device_id: z.number().int().positive().nullable() }), req.body);
    const peer = await one('SELECT * FROM wg_peers WHERE id = $1', [id]);
    if (!peer) throw notFound('Peer não encontrado.');
    let device = null;
    if (b.device_id) {
      device = await one('SELECT id, name, client_id, is_central FROM devices WHERE id = $1', [b.device_id]);
      if (!device) throw notFound('Equipamento não encontrado.');
      if (!canAccessDevice(user, device)) throw forbidden('Você não tem acesso a este equipamento.');
    }
    await query('UPDATE wg_peers SET device_id = $2 WHERE id = $1', [id, b.device_id]);
    await audit(req, {
      action: b.device_id ? 'wireguard.link' : 'wireguard.unlink',
      device: device ?? (peer.device_id ? await one('SELECT id, name, client_id FROM devices WHERE id = $1', [peer.device_id]) : null),
      target: peer.name || peer.comment || peer.allowed_address,
      details: { public_key: peer.public_key, previous_device_id: peer.device_id },
    });
    return { ok: true };
  });
}
