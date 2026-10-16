import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { newToken, sha256 } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { effectivePermissions, type Permission, type Role } from './permissions.js';

export const COOKIE_NAME = 'slot1_session';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  permissions: Set<Permission>;
  allClients: boolean;
  clientIds: number[];
  mustChangePassword: boolean;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function createSession(reply: FastifyReply, req: FastifyRequest, userId: number): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await query(
    'INSERT INTO sessions(id, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [sha256(token), userId, expires, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    expires,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[COOKIE_NAME];
  if (token) await query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function loadUserById(userId: number, sessionId = ''): Promise<AuthUser | undefined> {
  const u = await one(
    `SELECT u.*, COALESCE(array_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS client_ids
       FROM users u LEFT JOIN user_clients uc ON uc.user_id = u.id
      WHERE u.id = $1 AND u.active GROUP BY u.id`,
    [userId],
  );
  if (!u) return undefined;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    permissions: effectivePermissions(u.role, u.permissions_grant, u.permissions_revoke),
    allClients: u.role === 'admin' || u.all_clients,
    clientIds: u.client_ids,
    mustChangePassword: u.must_change_password,
    sessionId,
  };
}

/** Hook global: resolve o usuário a partir do cookie de sessão (sem exigir login). */
export async function resolveUser(req: FastifyRequest): Promise<void> {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return;
  const id = sha256(token);
  const s = await one('SELECT user_id, last_seen_at FROM sessions WHERE id = $1 AND expires_at > now()', [id]);
  if (!s) return;
  req.user = await loadUserById(s.user_id, id);
  if (req.user && Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
    await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Garante login e todas as permissões indicadas. */
export function requirePerm(req: FastifyRequest, ...perms: Permission[]): AuthUser {
  const user = requireUser(req);
  if (user.mustChangePassword) throw forbidden('Altere sua senha antes de continuar.');
  for (const p of perms) if (!user.permissions.has(p)) throw forbidden();
  return user;
}

export function hasPerm(user: AuthUser, p: Permission): boolean {
  return user.permissions.has(p);
}

/** Verificação de escopo por cliente. A central só é acessível a quem vê todos os clientes. */
export function canAccessDevice(user: AuthUser, device: { client_id: number | null; is_central: boolean }): boolean {
  if (user.allClients) return true;
  if (device.is_central || device.client_id == null) return false;
  return user.clientIds.includes(device.client_id);
}

export function canAccessClient(user: AuthUser, clientId: number): boolean {
  return user.allClients || user.clientIds.includes(clientId);
}

/** Fragmento SQL para restringir equipamentos ao escopo do usuário. */
export function deviceScopeSql(user: AuthUser, alias: string, params: unknown[]): string {
  if (user.allClients) return 'TRUE';
  params.push(user.clientIds);
  return `(${alias}.client_id = ANY($${params.length}::int[]) AND NOT ${alias}.is_central)`;
}

export function clientScopeSql(user: AuthUser, alias: string, params: unknown[]): string {
  if (user.allClients) return 'TRUE';
  params.push(user.clientIds);
  return `${alias}.id = ANY($${params.length}::int[])`;
}
