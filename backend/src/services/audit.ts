import type { FastifyRequest } from 'fastify';
import { query } from '../db/pool.js';

const SENSITIVE_KEYS = /pass|senha|secret|token|private|credential/i;

/** Remove qualquer campo potencialmente sensível antes de gravar na auditoria. */
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[omitido]' : sanitize(v);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  action: string;
  success?: boolean;
  device?: { id: number; name: string; client_id?: number | null } | null;
  /** Controladora UniFi (auditoria por equipamento). */
  controller?: { id: number; name: string; client_id?: number | null } | null;
  clientId?: number | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
}

export async function audit(req: FastifyRequest | null, entry: AuditEntry): Promise<void> {
  const user = req?.user;
  await query(
    `INSERT INTO audit_log(user_id, username, action, success, device_id, device_name, client_id, target, details, ip, unifi_controller_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      user?.id ?? null,
      user?.username ?? (entry.details?.username as string | undefined) ?? null,
      entry.action,
      entry.success ?? true,
      entry.device?.id ?? null,
      entry.device?.name ?? entry.controller?.name ?? null,
      entry.clientId ?? entry.device?.client_id ?? entry.controller?.client_id ?? null,
      entry.target ?? null,
      entry.details ? JSON.stringify(sanitize(entry.details)) : null,
      req?.ip ?? null,
      entry.controller?.id ?? null,
    ],
  );
}
