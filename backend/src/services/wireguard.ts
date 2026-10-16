import { config } from '../config.js';
import { one, query, tx } from '../db/pool.js';
import { stripSecrets } from '../modules/registry.js';
import { parseDuration, toBool, toInt } from '../routeros/parse.js';
import { RosError } from '../routeros/types.js';
import { runOnDevice, type DeviceRow } from './devices.js';

export const WG_CACHE_MODULE = 'wg_central';

export type PeerState = 'disabled' | 'never' | 'recent' | 'stale';

/** Estado do túnel apenas — não indica se a MikroTik remota está gerenciável. */
export function peerState(p: { disabled: boolean; last_handshake_seconds: number | null; collected_at: Date | string }): PeerState {
  if (p.disabled) return 'disabled';
  if (p.last_handshake_seconds == null) return 'never';
  const age = p.last_handshake_seconds + (Date.now() - new Date(p.collected_at).getTime()) / 1000;
  return age <= config.wgHandshakeStaleSec ? 'recent' : 'stale';
}

/** Primeiro IP /32 dos allowed-address: sugestão de endereço de gerência via túnel. */
export function suggestHost(allowed: string | null): string | null {
  for (const part of (allowed ?? '').split(',')) {
    const m = part.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/32)?$/);
    if (m) return m[1];
  }
  return null;
}

export async function getCentral(): Promise<DeviceRow | undefined> {
  return one<DeviceRow>('SELECT * FROM devices WHERE is_central');
}

/** Lê os peers da central e atualiza a tabela local (sem alterar nada no roteador). */
export async function syncCentralPeers(): Promise<{ ok: boolean; error?: string; count?: number }> {
  const central = await getCentral();
  if (!central) return { ok: false, error: 'MikroTik central não cadastrada.' };
  try {
    const { peers, interfaces } = await runOnDevice(central, async (c) => ({
      interfaces: (await c.print('/interface/wireguard')).map(stripSecrets),
      peers: (await c.print('/interface/wireguard/peers')).map(stripSecrets),
    }));
    await tx(async (db) => {
      const keys: string[] = [];
      for (const p of peers) {
        const key = p['public-key'];
        if (!key) continue;
        keys.push(key);
        await db.query(
          `INSERT INTO wg_peers(central_device_id, ros_id, public_key, interface, name, comment, allowed_address,
              endpoint_address, endpoint_port, current_endpoint_address, current_endpoint_port,
              last_handshake_seconds, rx_bytes, tx_bytes, disabled, present, collected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,now())
           ON CONFLICT (central_device_id, public_key) DO UPDATE SET
              ros_id = EXCLUDED.ros_id, interface = EXCLUDED.interface, name = EXCLUDED.name, comment = EXCLUDED.comment,
              allowed_address = EXCLUDED.allowed_address, endpoint_address = EXCLUDED.endpoint_address,
              endpoint_port = EXCLUDED.endpoint_port, current_endpoint_address = EXCLUDED.current_endpoint_address,
              current_endpoint_port = EXCLUDED.current_endpoint_port, last_handshake_seconds = EXCLUDED.last_handshake_seconds,
              rx_bytes = EXCLUDED.rx_bytes, tx_bytes = EXCLUDED.tx_bytes, disabled = EXCLUDED.disabled,
              present = TRUE, collected_at = now()`,
          [
            central.id, p['.id'] ?? null, key, p.interface ?? null, p.name ?? null, p.comment ?? null,
            p['allowed-address'] ?? null, p['endpoint-address'] || null, toInt(p['endpoint-port']) || null,
            p['current-endpoint-address'] || null, toInt(p['current-endpoint-port']) || null,
            parseDuration(p['last-handshake']), toInt(p.rx), toInt(p.tx), toBool(p.disabled),
          ],
        );
      }
      // Peers removidos da central permanecem no histórico, marcados como ausentes.
      await db.query('UPDATE wg_peers SET present = FALSE WHERE central_device_id = $1 AND NOT (public_key = ANY($2::text[]))', [central.id, keys]);
      await db.query(
        `INSERT INTO module_cache(device_id, module, data, collected_at, last_error, last_error_at)
         VALUES ($1,$2,$3,now(),NULL,NULL)
         ON CONFLICT (device_id, module) DO UPDATE SET data = EXCLUDED.data, collected_at = now(), last_error = NULL, last_error_at = NULL`,
        [central.id, WG_CACHE_MODULE, JSON.stringify({ interfaces })],
      );
    });
    return { ok: true, count: peers.length };
  } catch (e) {
    const msg = e instanceof RosError ? e.message : (e as Error).message;
    await query(
      `INSERT INTO module_cache(device_id, module, last_error, last_error_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (device_id, module) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = now()`,
      [central.id, WG_CACHE_MODULE, msg],
    );
    if (!(e instanceof RosError)) throw e;
    return { ok: false, error: msg };
  }
}
