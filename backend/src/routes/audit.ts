import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { parse } from '../lib/validate.js';
import { requirePerm } from '../auth/session.js';

/**
 * Escopos da auditoria:
 *  - device_id: eventos de um equipamento;
 *  - scope=system: eventos que não pertencem a equipamento (logins, usuários, clientes, notificações);
 *  - scope=removed: eventos de equipamentos já excluídos do cadastro (o nome fica preservado).
 */
const scopeSchema = z.object({
  device_id: z.coerce.number().int().optional(),
  controller_id: z.coerce.number().int().optional(),
  scope: z.enum(['system', 'removed']).optional(),
});

function scopeWhere(q: z.infer<typeof scopeSchema>, params: unknown[], where: string[]) {
  if (q.device_id) {
    params.push(q.device_id);
    where.push(`a.device_id = $${params.length}`);
  } else if (q.controller_id) {
    params.push(q.controller_id);
    where.push(`a.unifi_controller_id = $${params.length}`);
  } else if (q.scope === 'system') {
    where.push('a.device_id IS NULL AND a.unifi_controller_id IS NULL AND a.device_name IS NULL');
  } else if (q.scope === 'removed') {
    where.push('a.device_id IS NULL AND a.unifi_controller_id IS NULL AND a.device_name IS NOT NULL');
  }
}

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', async (req) => {
    requirePerm(req, 'audit.view');
    const q = parse(
      scopeSchema.extend({
        search: z.string().trim().max(100).optional(),
        action: z.string().max(60).optional(),
        user_id: z.coerce.number().int().optional(),
        from: z.string().max(30).optional(),
        to: z.string().max(30).optional(),
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(10).max(200).default(50),
      }),
      req.query,
    );
    const params: unknown[] = [];
    const where: string[] = ['TRUE'];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    scopeWhere(q, params, where);
    if (q.search) {
      params.push(`%${q.search}%`);
      const n = params.length;
      where.push(`(a.target ILIKE $${n} OR a.username ILIKE $${n} OR a.device_name ILIKE $${n})`);
    }
    if (q.action) add('a.action LIKE ?', `${q.action}%`);
    if (q.user_id) add('a.user_id = ?', q.user_id);
    if (q.from) add('a.at >= ?::timestamptz', q.from);
    if (q.to) add('a.at <= ?::timestamptz', q.to);
    const w = where.join(' AND ');
    const total = (await one(`SELECT count(*)::int AS n FROM audit_log a WHERE ${w}`, params)).n;
    params.push(q.page_size, (q.page - 1) * q.page_size);
    const rows = await query(
      `SELECT a.*, c.name AS client_name FROM audit_log a LEFT JOIN clients c ON c.id = a.client_id
        WHERE ${w} ORDER BY a.at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { total, page: q.page, page_size: q.page_size, rows };
  });

  /** Ações existentes no escopo (para o filtro da tela). */
  app.get('/api/audit/actions', async (req) => {
    requirePerm(req, 'audit.view');
    const q = parse(scopeSchema, req.query);
    const params: unknown[] = [];
    const where: string[] = ['TRUE'];
    scopeWhere(q, params, where);
    return (await query(`SELECT DISTINCT a.action FROM audit_log a WHERE ${where.join(' AND ')} ORDER BY a.action`, params)).map((r) => r.action);
  });

  /** Resumo por equipamento + cards "Sistema" e "Equipamentos removidos". */
  app.get('/api/audit/devices', async (req) => {
    requirePerm(req, 'audit.view');
    const stats = `count(a.id)::int AS total,
      count(a.id) FILTER (WHERE a.at > now() - interval '7 days')::int AS last_7d,
      count(a.id) FILTER (WHERE NOT a.success)::int AS failures,
      count(a.id) FILTER (WHERE a.action LIKE '%password.view')::int AS sensitive,
      max(a.at) AS last_at`;
    const devices = await query(
      `SELECT d.id AS device_id, d.name AS device_name, d.host, d.is_central, d.status, c.name AS client_name, ${stats},
              (SELECT row_to_json(x) FROM (SELECT l.action, l.username, l.at FROM audit_log l WHERE l.device_id = d.id ORDER BY l.at DESC LIMIT 1) x) AS last
         FROM devices d
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN audit_log a ON a.device_id = d.id
        GROUP BY d.id, c.name
        ORDER BY d.is_central DESC, max(a.at) DESC NULLS LAST, c.name, d.name`,
    );
    const lastOf = (w: string) =>
      `(SELECT row_to_json(x) FROM (SELECT l.action, l.username, l.at FROM audit_log l WHERE ${w.replaceAll('a.', 'l.')} ORDER BY l.at DESC LIMIT 1) x) AS last`;
    const sysW = 'a.device_id IS NULL AND a.unifi_controller_id IS NULL AND a.device_name IS NULL';
    const remW = 'a.device_id IS NULL AND a.unifi_controller_id IS NULL AND a.device_name IS NOT NULL';
    const system = await one(`SELECT ${stats}, ${lastOf(sysW)} FROM audit_log a WHERE ${sysW}`);
    const removed = await one(`SELECT ${stats}, count(DISTINCT a.device_name)::int AS devices, ${lastOf(remW)} FROM audit_log a WHERE ${remW}`);
    const controllers = await query(
      `SELECT u.id AS controller_id, u.name AS device_name, u.url AS host, u.status, c.name AS client_name, ${stats},
              (SELECT row_to_json(x) FROM (SELECT l.action, l.username, l.at FROM audit_log l WHERE l.unifi_controller_id = u.id ORDER BY l.at DESC LIMIT 1) x) AS last
         FROM unifi_controllers u
         LEFT JOIN clients c ON c.id = u.client_id
         LEFT JOIN audit_log a ON a.unifi_controller_id = u.id
        GROUP BY u.id, c.name
        ORDER BY max(a.at) DESC NULLS LAST, c.name, u.name`,
    );
    return { system, removed, devices, controllers };
  });
}
