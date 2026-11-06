import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canAccessClient, requirePerm, type AuthUser } from '../auth/session.js';
import { one, query } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { idParam, optionalText, parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';

const KINDS = ['os_futura', 'orcamento', 'lembrete'] as const;
const STATUSES = ['pendente', 'aguardando', 'concluido', 'descartado'] as const;

const checklist = z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(100).default([]);

const itemSchema = z.object({
  kind: z.enum(KINDS).default('os_futura'),
  title: z.string().trim().min(2, 'Informe o título').max(200),
  notes: optionalText(10000),
  client_id: z.number().int().positive().nullable().default(null),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullable().optional().transform((v) => v ?? null),
  priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).default('normal'),
  status: z.enum(STATUSES).default('pendente'),
  amount: z.number().min(0, 'Valor não pode ser negativo').max(100_000_000).nullable().default(null),
  checklist,
});

const SELECT = `
  SELECT p.id, p.kind, p.title, p.notes, p.client_id, to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.priority, p.status,
         p.amount::float8 AS amount, p.checklist, p.service_order_id, p.created_at, p.updated_at, p.done_at,
         c.name AS client_name, cb.name AS created_by_name, ub.name AS updated_by_name, so.status AS service_order_status
    FROM planner_items p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN users cb ON cb.id = p.created_by
    LEFT JOIN users ub ON ub.id = p.updated_by
    LEFT JOIN service_orders so ON so.id = p.service_order_id`;

async function load(user: AuthUser, id: number) {
  const p = await one(`${SELECT} WHERE p.id = $1`, [id]);
  if (!p) throw notFound('Item não encontrado.');
  if (p.client_id && !canAccessClient(user, p.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
  return p;
}

function checkClient(user: AuthUser, clientId: number | null) {
  if (clientId && !canAccessClient(user, clientId)) throw forbidden('Você não tem acesso a esse cliente.');
}

/** Planejamento: ordens futuras, orçamentos e lembretes (por padrão, só administradores). */
export async function plannerRoutes(app: FastifyInstance) {
  app.get('/api/planner', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const qs = parse(z.object({
      view: z.enum(['abertos', 'encerrados', 'todos']).default('abertos'),
      kind: z.enum(KINDS).optional(),
      q: z.string().trim().max(100).optional(),
    }), req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!user.allClients) {
      params.push(user.clientIds);
      where.push(`(p.client_id IS NULL OR p.client_id = ANY($${params.length}::int[]))`);
    }
    if (qs.q) {
      params.push(`%${qs.q}%`);
      where.push(`(p.title ILIKE $${params.length} OR p.notes ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    const scope = where.length ? where.join(' AND ') : 'TRUE';
    const counts = await query(
      `SELECT p.kind, count(*) FILTER (WHERE p.status NOT IN ('concluido','descartado'))::int AS open,
              count(*) FILTER (WHERE p.status NOT IN ('concluido','descartado') AND p.due_date < current_date)::int AS overdue
         FROM planner_items p LEFT JOIN clients c ON c.id = p.client_id WHERE ${scope} GROUP BY p.kind`,
      params,
    );
    if (qs.kind) {
      params.push(qs.kind);
      where.push(`p.kind = $${params.length}`);
    }
    if (qs.view === 'abertos') where.push(`p.status NOT IN ('concluido','descartado')`);
    if (qs.view === 'encerrados') where.push(`p.status IN ('concluido','descartado')`);
    const rows = await query(
      `${SELECT} WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
        ORDER BY CASE WHEN p.status IN ('concluido','descartado') THEN 1 ELSE 0 END,
                 CASE WHEN p.status IN ('concluido','descartado') THEN NULL ELSE p.due_date END ASC NULLS LAST,
                 array_position(ARRAY['urgente','alta','normal','baixa'], p.priority),
                 COALESCE(p.done_at, p.created_at) DESC
        LIMIT 1000`,
      params,
    );
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.kind, { open: c.open, overdue: c.overdue }])) };
  });

  app.post('/api/planner', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const b = parse(itemSchema, req.body);
    checkClient(user, b.client_id);
    const r = await one(
      `INSERT INTO planner_items(kind, title, notes, client_id, due_date, priority, status, amount, checklist, created_by, updated_by, done_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, CASE WHEN $7 IN ('concluido','descartado') THEN now() END) RETURNING id`,
      [b.kind, b.title, b.notes, b.client_id, b.due_date, b.priority, b.status, b.amount, JSON.stringify(b.checklist), user.id],
    );
    await audit(req, { action: 'planner.create', clientId: b.client_id, target: b.title, details: { kind: b.kind } });
    return load(user, r.id);
  });

  app.put('/api/planner/:id', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const { id } = parse(idParam, req.params);
    const cur = await load(user, id);
    const b = parse(itemSchema, req.body);
    checkClient(user, b.client_id);
    await query(
      `UPDATE planner_items SET kind=$2, title=$3, notes=$4, client_id=$5, due_date=$6, priority=$7, status=$8, amount=$9, checklist=$10,
              updated_by=$11, updated_at=now(),
              done_at = CASE WHEN $8 IN ('concluido','descartado') THEN COALESCE(done_at, now()) END
        WHERE id=$1`,
      [cur.id, b.kind, b.title, b.notes, b.client_id, b.due_date, b.priority, b.status, b.amount, JSON.stringify(b.checklist), user.id],
    );
    return load(user, id);
  });

  /** Atalhos da lista: marcar situação e marcar itens do checklist sem reenviar o item inteiro. */
  app.post('/api/planner/:id/status', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const { id } = parse(idParam, req.params);
    await load(user, id);
    const b = parse(z.object({ status: z.enum(STATUSES) }), req.body);
    await query(
      `UPDATE planner_items SET status=$2, updated_by=$3, updated_at=now(),
              done_at = CASE WHEN $2 IN ('concluido','descartado') THEN COALESCE(done_at, now()) END WHERE id=$1`,
      [id, b.status, user.id],
    );
    return load(user, id);
  });

  app.put('/api/planner/:id/checklist', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const { id } = parse(idParam, req.params);
    await load(user, id);
    const b = parse(z.object({ checklist }), req.body);
    await query('UPDATE planner_items SET checklist=$2, updated_by=$3, updated_at=now() WHERE id=$1', [id, JSON.stringify(b.checklist), user.id]);
    return load(user, id);
  });

  /** Liga o item à OS gerada a partir dele e o marca como concluído. */
  app.post('/api/planner/:id/link', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const { id } = parse(idParam, req.params);
    const cur = await load(user, id);
    const b = parse(z.object({ service_order_id: z.number().int().positive() }), req.body);
    const os = await one('SELECT id, title FROM service_orders WHERE id = $1', [b.service_order_id]);
    if (!os) throw badRequest('Ordem de serviço não encontrada.');
    await query(
      `UPDATE planner_items SET service_order_id=$2, status='concluido', done_at=COALESCE(done_at, now()), updated_by=$3, updated_at=now() WHERE id=$1`,
      [id, os.id, user.id],
    );
    await audit(req, { action: 'planner.to_os', clientId: cur.client_id, target: cur.title, details: { service_order_id: os.id } });
    return load(user, id);
  });

  app.delete('/api/planner/:id', async (req) => {
    const user = requirePerm(req, 'planner.manage');
    const { id } = parse(idParam, req.params);
    const cur = await load(user, id);
    await query('DELETE FROM planner_items WHERE id = $1', [id]);
    // A auditoria guarda o conteúdo, para recuperar algo apagado por engano.
    await audit(req, { action: 'planner.delete', clientId: cur.client_id, target: cur.title, details: { kind: cur.kind, notes: cur.notes, checklist: cur.checklist } });
    return { ok: true };
  });
}
