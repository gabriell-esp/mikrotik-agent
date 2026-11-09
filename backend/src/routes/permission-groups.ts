import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ALL_PERMISSIONS } from '../auth/permissions.js';
import { requirePerm } from '../auth/session.js';
import { one, query, tx } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';

const groupSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do grupo').max(60),
  description: z.string().trim().max(300).optional().nullable().or(z.literal('')),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length).default([]),
  /** Membros do grupo (substitui a lista atual). Administradores são ignorados: já têm tudo. */
  member_ids: z.array(z.number().int().positive()).max(1000).optional(),
});

const SELECT_GROUPS = `SELECT g.id, g.name, g.description, g.permissions, g.created_at, g.updated_at,
       COALESCE(array_agg(ug.user_id ORDER BY ug.user_id) FILTER (WHERE ug.user_id IS NOT NULL), '{}') AS member_ids
  FROM permission_groups g LEFT JOIN user_groups ug ON ug.group_id = g.id`;

const present = (g: any) => ({ ...g, permissions: [...g.permissions].sort(), members: g.member_ids.length });

async function setMembers(db: { query: (sql: string, p?: unknown[]) => Promise<unknown> }, groupId: number, ids: number[]) {
  await db.query('DELETE FROM user_groups WHERE group_id = $1', [groupId]);
  if (!ids.length) return;
  await db.query(
    `INSERT INTO user_groups(user_id, group_id) SELECT id, $1 FROM users WHERE id = ANY($2::int[]) AND role <> 'admin' ON CONFLICT DO NOTHING`,
    [groupId, ids],
  );
}

const nameTaken = async (name: string, exceptId = 0) =>
  !!(await one('SELECT 1 FROM permission_groups WHERE lower(name) = lower($1) AND id <> $2', [name, exceptId]));

export async function permissionGroupRoutes(app: FastifyInstance) {
  app.get('/api/permission-groups', async (req) => {
    requirePerm(req, 'users.manage');
    return (await query(`${SELECT_GROUPS} GROUP BY g.id ORDER BY lower(g.name)`)).map(present);
  });

  app.post('/api/permission-groups', async (req) => {
    requirePerm(req, 'users.manage');
    const b = parse(groupSchema, req.body);
    if (await nameTaken(b.name)) throw conflict('Já existe um grupo com esse nome.');
    const id = await tx(async (db) => {
      const r = await db.query('INSERT INTO permission_groups(name, description, permissions) VALUES ($1,$2,$3) RETURNING id', [b.name, b.description || null, b.permissions]);
      const id = r.rows[0].id as number;
      if (b.member_ids) await setMembers(db, id, b.member_ids);
      return id;
    });
    await audit(req, { action: 'group.create', target: b.name, details: { permissions: b.permissions, members: b.member_ids ?? [] } });
    return present(await one(`${SELECT_GROUPS} WHERE g.id = $1 GROUP BY g.id`, [id]));
  });

  app.put('/api/permission-groups/:id', async (req) => {
    requirePerm(req, 'users.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(groupSchema, req.body);
    const cur = await one('SELECT name FROM permission_groups WHERE id = $1', [id]);
    if (!cur) throw notFound('Grupo não encontrado.');
    if (await nameTaken(b.name, id)) throw conflict('Já existe um grupo com esse nome.');
    await tx(async (db) => {
      await db.query('UPDATE permission_groups SET name=$2, description=$3, permissions=$4, updated_at=now() WHERE id=$1', [id, b.name, b.description || null, b.permissions]);
      if (b.member_ids) await setMembers(db, id, b.member_ids);
    });
    await audit(req, { action: 'group.update', target: b.name, details: { renamed_from: cur.name !== b.name ? cur.name : undefined, permissions: b.permissions, members: b.member_ids } });
    return present(await one(`${SELECT_GROUPS} WHERE g.id = $1 GROUP BY g.id`, [id]));
  });

  /** Excluir o grupo: os membros voltam ao padrão do perfil (ou aos outros grupos que tiverem). */
  app.delete('/api/permission-groups/:id', async (req) => {
    requirePerm(req, 'users.manage');
    const { id } = parse(idParam, req.params);
    const cur = await one('DELETE FROM permission_groups WHERE id = $1 RETURNING name', [id]);
    if (!cur) throw notFound('Grupo não encontrado.');
    await audit(req, { action: 'group.delete', target: cur.name });
    return { ok: true };
  });
}
