import type { FastifyBaseLogger } from 'fastify';
import { query } from '../db/pool.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';

export const USER_SETTINGS = 'users';
export interface UserSettings {
  /** Dias desativado até a exclusão automática. 0 = desligada. */
  auto_delete_days: number;
}

/**
 * Exclui usuários desativados há mais dias que o configurado. O histórico continua: auditoria e
 * eventos das ordens guardam o nome, e as referências nas ordens ficam vazias (ON DELETE SET NULL).
 */
export async function purgeInactiveUsers(log?: FastifyBaseLogger): Promise<string[]> {
  const s = await getSetting<UserSettings>(USER_SETTINGS, { auto_delete_days: 0 });
  if (!s.auto_delete_days || s.auto_delete_days < 1) return [];
  const gone = await query<{ id: number; username: string; name: string; deactivated_at: string }>(
    `DELETE FROM users WHERE NOT active AND deactivated_at IS NOT NULL AND deactivated_at < now() - make_interval(days => $1)
     RETURNING id, username, name, deactivated_at`,
    [s.auto_delete_days],
  );
  for (const u of gone) {
    await audit(null, {
      action: 'user.auto_delete',
      target: u.username,
      details: { name: u.name, deactivated_at: u.deactivated_at, days: s.auto_delete_days },
    });
    log?.info(`Usuário ${u.username} excluído automaticamente (desativado desde ${u.deactivated_at}).`);
  }
  return gone.map((u) => u.username);
}

/** Verifica a cada hora (e logo após iniciar). */
export function startUserCleanup(log: FastifyBaseLogger): () => void {
  const run = () => purgeInactiveUsers(log).catch((e) => log.error(e, 'Falha na exclusão automática de usuários'));
  const first = setTimeout(run, 30_000);
  const t = setInterval(run, 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(t);
  };
}
