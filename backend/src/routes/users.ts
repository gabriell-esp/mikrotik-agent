import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db/pool.js';
import { hashPassword } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { ALL_PERMISSIONS, effectivePermissions } from '../auth/permissions.js';
import { requirePerm } from '../auth/session.js';
import { audit } from '../services/audit.js';
import { passwordPolicy } from './auth.js';

const permList = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]);

const userBase = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(100),
  email: z.string().trim().email('E-mail inválido').max(200).optional().nullable().or(z.literal('')),
  role: z.enum(['admin', 'tecnico', 'escritorio']),
  permissions_grant: permList,
  permissions_revoke: permList,
  all_clients: z.boolean().default(false),
  client_ids: z.array(z.number().int().positive()).default([]),
  active: z.boolean().default(true),
});

const createSchema = userBase.extend({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Use 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado'),
  password: passwordPolicy,
  must_change_password: z.boolean().default(true),
});

function present(u: any) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions_grant: u.permissions_grant,
    permissions_revoke: u.permissions_revoke,
    effective_permissions: [...effectivePermissions(u.role, u.permissions_grant, u.permissions_revoke)],
    all_clients: u.all_clients,
    client_ids: u.client_ids ?? [],
    active: u.active,
    must_change_password: u.must_change_password,
    locked: !!u.locked_until && new Date(u.locked_until) > new Date(),
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  };
}

const SELECT_USERS = `SELECT u.*, COALESCE(array_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS client_ids
  FROM users u LEFT JOIN user_clients uc ON uc.user_id = u.id`;

async function activeAdmins(excludeId: number): Promise<number> {
  const r = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [excludeId]);
  return r.n;
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', async (req) => {
    requirePerm(req, 'users.manage');
    return (await query(`${SELECT_USERS} GROUP BY u.id ORDER BY u.name`)).map(present);
  });

  app.post('/api/users', async (req) => {
    requirePerm(req, 'users.manage');
    const b = parse(createSchema, req.body);
    if (await one('SELECT 1 FROM users WHERE username = $1', [b.username])) throw conflict('Já existe um usuário com esse login.');
    const hash = await hashPassword(b.password);
    const id = await tx(async (db) => {
      const r = await db.query(
        `INSERT INTO users(username, name, email, password_hash, role, permissions_grant, permissions_revoke, all_clients, active, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [b.username, b.name, b.email || null, hash, b.role, b.permissions_grant, b.permissions_revoke, b.all_clients, b.active, b.must_change_password],
      );
      const id = r.rows[0].id;
      for (const c of b.client_ids) await db.query('INSERT INTO user_clients VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, c]);
      return id;
    });
    await audit(req, { action: 'user.create', target: b.username, details: { role: b.role, all_clients: b.all_clients, client_ids: b.client_ids, grant: b.permissions_grant, revoke: b.permissions_revoke } });
    return present(await one(`${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [id]));
  });

  app.put('/api/users/:id', async (req) => {
    const me = requirePerm(req, 'users.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(userBase, req.body);
    const cur = await one('SELECT * FROM users WHERE id = $1', [id]);
    if (!cur) throw notFound('Usuário não encontrado.');
    const losingAdmin = cur.role === 'admin' && cur.active && (b.role !== 'admin' || !b.active);
    if (losingAdmin && (await activeAdmins(id)) === 0) throw badRequest('É necessário manter ao menos um administrador ativo.');
    if (id === me.id && (!b.active || b.role !== cur.role)) throw badRequest('Você não pode desativar ou alterar o próprio perfil.');
    await tx(async (db) => {
      await db.query(
        `UPDATE users SET name=$2, email=$3, role=$4, permissions_grant=$5, permissions_revoke=$6, all_clients=$7, active=$8, updated_at=now() WHERE id=$1`,
        [id, b.name, b.email || null, b.role, b.permissions_grant, b.permissions_revoke, b.all_clients, b.active],
      );
      await db.query('DELETE FROM user_clients WHERE user_id = $1', [id]);
      for (const c of b.client_ids) await db.query('INSERT INTO user_clients VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, c]);
      if (!b.active) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    });
    await audit(req, { action: 'user.update', target: cur.username, details: { role: b.role, active: b.active, all_clients: b.all_clients, client_ids: b.client_ids, grant: b.permissions_grant, revoke: b.permissions_revoke } });
    return present(await one(`${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [id]));
  });

  app.post('/api/users/:id/reset-password', async (req) => {
    requirePerm(req, 'users.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ password: passwordPolicy }), req.body);
    const cur = await one('SELECT username FROM users WHERE id = $1', [id]);
    if (!cur) throw notFound('Usuário não encontrado.');
    await query(
      `UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1`,
      [id, await hashPassword(b.password)],
    );
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(req, { action: 'user.reset_password', target: cur.username });
    return { ok: true };
  });

  app.post('/api/users/:id/unlock', async (req) => {
    requirePerm(req, 'users.manage');
    const { id } = parse(idParam, req.params);
    const cur = await one('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1 RETURNING username', [id]);
    if (!cur) throw notFound('Usuário não encontrado.');
    await audit(req, { action: 'user.unlock', target: cur.username });
    return { ok: true };
  });
}
