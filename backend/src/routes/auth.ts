import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS } from '../auth/permissions.js';
import { createSession, destroySession, requireUser, type AuthUser } from '../auth/session.js';
import { audit } from '../services/audit.js';

export const passwordPolicy = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres')
  .max(128)
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), 'Use letras e números');

export function publicUser(u: AuthUser) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    permissions: [...u.permissions],
    allClients: u.allClients,
    clientIds: u.clientIds,
    mustChangePassword: u.mustChangePassword,
  };
}

// Hash fixo para igualar o tempo de resposta quando o usuário não existe.
const DUMMY_HASH = hashPassword('dummy-password-0');

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) }), req.body);
    const username = body.username.toLowerCase();
    const u = await one('SELECT * FROM users WHERE username = $1', [username]);
    const fail = async (reason: string) => {
      await audit(req, { action: 'auth.login', success: false, details: { username, reason } });
      return new AppError(401, 'invalid_login', 'Usuário ou senha inválidos.');
    };
    if (!u) {
      await verifyPassword(body.password, await DUMMY_HASH);
      throw await fail('usuário inexistente');
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      await audit(req, { action: 'auth.login', success: false, details: { username, reason: 'bloqueado' } });
      throw new AppError(429, 'locked', 'Muitas tentativas. Tente novamente em alguns minutos.');
    }
    const ok = await verifyPassword(body.password, u.password_hash);
    if (!ok || !u.active) {
      if (!ok) {
        await query(
          `UPDATE users SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`,
          [u.id, config.loginMaxAttempts, config.loginLockMinutes],
        );
      }
      throw await fail(ok ? 'usuário inativo' : 'senha incorreta');
    }
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    await createSession(reply, req, u.id);
    await audit(req, { action: 'auth.login', details: { username } });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) await audit(req, { action: 'auth.logout' });
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = requireUser(req);
    return { user: publicUser(u), permissionCatalog: PERMISSIONS, roles: ROLE_LABELS, roleDefaults: ROLE_DEFAULTS };
  });

  app.post('/api/auth/change-password', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ current: z.string().min(1), password: passwordPolicy }), req.body);
    const row = await one('SELECT password_hash FROM users WHERE id = $1', [u.id]);
    if (!(await verifyPassword(body.current, row.password_hash))) throw badRequest('Senha atual incorreta.');
    if (body.current === body.password) throw badRequest('A nova senha deve ser diferente da atual.');
    await query('UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = now() WHERE id = $1', [u.id, await hashPassword(body.password)]);
    // Encerra as outras sessões do usuário.
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [u.id, u.sessionId]);
    await audit(req, { action: 'auth.change_password' });
    return { ok: true };
  });
}
