import { one, query } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { secretBox } from '../lib/secrets.js';
import { withRouter } from '../routeros/manager.js';
import { RosError, type DeviceConnInfo, type RosClient } from '../routeros/types.js';

export type DeviceStatus = 'unknown' | 'online' | 'unreachable' | 'auth_failed' | 'error';

export interface DeviceRow {
  id: number;
  client_id: number | null;
  name: string;
  is_central: boolean;
  host: string;
  api_method: DeviceConnInfo['api_method'];
  api_ssl_port: number;
  rest_port: number;
  api_port: number;
  allow_plaintext: boolean;
  tls_fingerprint: string | null;
  username: string;
  password_enc: string;
  poll_enabled: boolean;
  status: DeviceStatus;
  detected_method: string | null;
  ros_version: string | null;
}

export async function getDeviceRow(id: number): Promise<DeviceRow> {
  const d = await one<DeviceRow>('SELECT * FROM devices WHERE id = $1', [id]);
  if (!d) throw notFound('Equipamento não encontrado.');
  return d;
}

/** Decifra a senha do roteador; falha aqui indica chave mestra diferente da usada no cadastro. */
function decryptDevicePassword(d: DeviceRow): string {
  try {
    return secretBox().decrypt(d.password_enc);
  } catch {
    throw new RosError(
      'config',
      `Não foi possível decifrar a senha salva de "${d.name}": a chave mestra (MASTER_KEY) desta instância é diferente da usada no cadastro. ` +
        'Verifique se há outro backend rodando com outra chave contra o mesmo banco, ou salve a senha do equipamento novamente.',
    );
  }
}

export function connInfo(d: DeviceRow): DeviceConnInfo {
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    username: d.username,
    password: decryptDevicePassword(d),
    api_method: d.api_method,
    api_ssl_port: d.api_ssl_port,
    rest_port: d.rest_port,
    api_port: d.api_port,
    allow_plaintext: d.allow_plaintext,
    tls_fingerprint: d.tls_fingerprint,
    detected_method: d.detected_method,
  };
}

export function statusFromError(err: RosError): DeviceStatus {
  switch (err.kind) {
    case 'unreachable':
    case 'refused':
      return 'unreachable';
    case 'auth':
    case 'permission':
      return 'auth_failed';
    default:
      return 'error';
  }
}

/** Atualiza o status de gerência e registra evento quando houver mudança. */
export async function setDeviceStatus(id: number, status: DeviceStatus, message: string | null, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = Object.keys(extra);
  const sets = cols.map((c, i) => `${c} = $${i + 4}`);
  const prev = await one<{ status: string }>(
    `UPDATE devices d SET status = $2, status_message = $3, last_poll_at = now(),
       status_since = CASE WHEN prev.status IS DISTINCT FROM $2 THEN now() ELSE COALESCE(d.status_since, now()) END
       ${status === 'online' ? ', last_ok_at = now()' : ''}
       ${sets.length ? ', ' + sets.join(', ') : ''}
     FROM (SELECT status FROM devices WHERE id = $1) prev
     WHERE d.id = $1 RETURNING prev.status`,
    [id, status, message, ...cols.map((c) => extra[c])],
  );
  if (prev && prev.status !== status) {
    await query('INSERT INTO device_status_events(device_id, status, message) VALUES ($1,$2,$3)', [id, status, message]);
  }
}

/** Executa operações no roteador e mantém o status de gerência coerente com o resultado real. */
export async function runOnDevice<T>(d: DeviceRow, fn: (c: RosClient) => Promise<T>): Promise<T> {
  return withRouter(connInfo(d), fn, {
    onConnected: async (method) => {
      if (d.status !== 'online' || d.detected_method !== method) {
        await setDeviceStatus(d.id, 'online', null, { detected_method: method });
        d.status = 'online';
        d.detected_method = method;
      } else {
        await query('UPDATE devices SET last_poll_at = now(), last_ok_at = now() WHERE id = $1', [d.id]);
      }
    },
    onConnectError: async (err) => {
      const status = statusFromError(err);
      await setDeviceStatus(d.id, status, err.message);
      d.status = status;
    },
  });
}
