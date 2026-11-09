import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { effectivePermissions, userGroupColumns } from '../auth/permissions.js';
import { canAccessClient, hasPerm, requirePerm, requireUser, type AuthUser } from '../auth/session.js';
import { one, query, tx } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { idParam, optionalText, parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { phoneSchema } from './profile.js';

const PRIORITIES = ['baixa', 'normal', 'alta', 'urgente'] as const;
const OPEN = ['aberta', 'em_andamento', 'pausada'];
const MAX_PHOTOS = 40;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;

const orderSchema = z.object({
  title: z.string().trim().min(3, 'Informe o título').max(160),
  description: optionalText(5000),
  client_id: z.number().int().positive().nullable().default(null),
  location: optionalText(300),
  /** Ao menos um contato no local; o técnico abre o WhatsApp direto pela ordem. */
  contacts: z.array(z.object({
    name: z.string().trim().min(2, 'Informe o nome do contato').max(100),
    phone: phoneSchema,
  })).min(1, 'Informe ao menos um contato com telefone').max(5, 'Máximo de 5 contatos').prefault([]),
  priority: z.enum(PRIORITIES).default('normal'),
  assigned_to: z.number().int().positive().nullable().default(null),
  helper_id: z.number().int().positive().nullable().default(null),
  scheduled_for: z.string().datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
}).refine((b) => !b.helper_id || (b.assigned_to && b.helper_id !== b.assigned_to), {
  message: 'O técnico auxiliar deve ser diferente do responsável (e exige um responsável).', path: ['helper_id'],
});

/** Material usado (quantidade, sem valor) ou compra feita em loja durante o serviço (valor pago). */
const itemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('material'),
    description: z.string().trim().min(2, 'Descreva o material').max(300),
    quantity: z.number().positive('Quantidade deve ser maior que zero').max(1_000_000),
    unit: z.enum(['un', 'm']).default('un'),
  }),
  z.object({
    kind: z.literal('compra'),
    store: z.string().trim().min(2, 'Informe a loja').max(150),
    description: z.string().trim().min(2, 'Informe o que foi comprado').max(300),
    amount: z.number().positive('Informe o valor pago').max(10_000_000),
  }),
], { error: 'Escolha material ou compra.' });

const reportSchema = z.object({ report: z.string().trim().max(10000).default('') });
const photoSchema = z.object({
  image: z.string().min(10).max(8 * 1024 * 1024),
  thumb: z.string().min(10).max(800 * 1024),
  caption: optionalText(300),
});

const subId = (name: string) => z.object({ id: z.coerce.number().int().positive(), [name]: z.coerce.number().int().positive() });

// ------------------------------------------------------------------ acesso

/** Quem vê todas as ordens: permissão de ver todas ou de gerenciar (respeitando o escopo de clientes). */
const seesAll = (u: AuthUser) => hasPerm(u, 'os.view_all') || hasPerm(u, 'os.manage');
type Crew = { assigned_to: number | null; helper_id?: number | null };
/** Técnico da ordem: o responsável ou o auxiliar. */
const isExecutor = (u: AuthUser, o: Crew) => hasPerm(u, 'os.execute') && (o.assigned_to === u.id || (o.helper_id != null && o.helper_id === u.id));
const isPrincipal = (u: AuthUser, o: Crew) => hasPerm(u, 'os.execute') && o.assigned_to === u.id;

function requireOsUser(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (user.mustChangePassword) throw forbidden('Altere sua senha antes de continuar.');
  if (!seesAll(user) && !hasPerm(user, 'os.execute')) throw forbidden();
  return user;
}

function canSee(u: AuthUser, o: Crew & { client_id: number | null }) {
  if (isExecutor(u, o)) return true;
  return seesAll(u) && (o.client_id == null || canAccessClient(u, o.client_id));
}

/** Pode lançar relatório, gastos e fotos: técnico responsável ou quem gerencia, enquanto a ordem está aberta. */
function canWork(u: AuthUser, o: Crew & { status: string; client_id: number | null }) {
  return OPEN.includes(o.status) && (isExecutor(u, o) || (hasPerm(u, 'os.manage') && canSee(u, o)));
}

const BASE = `
  SELECT o.*, c.name AS client_name, a.name AS assigned_name, a.avatar_updated_at AS assigned_avatar, a.phone AS assigned_phone,
         h.name AS helper_name, h.avatar_updated_at AS helper_avatar, cb.name AS created_by_name,
         COALESCE((SELECT sum(extract(epoch FROM (t.ended_at - t.started_at))) FROM service_order_time t
                    WHERE t.order_id = o.id AND t.ended_at IS NOT NULL), 0)::float8 AS work_seconds,
         (SELECT t.started_at FROM service_order_time t WHERE t.order_id = o.id AND t.ended_at IS NULL) AS running_since,
         (SELECT count(*) FROM service_order_photos p WHERE p.order_id = o.id)::int AS photos,
         COALESCE((SELECT sum(i.amount) FROM service_order_items i WHERE i.order_id = o.id), 0)::float8 AS total_cost
    FROM service_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN users a ON a.id = o.assigned_to
    LEFT JOIN users h ON h.id = o.helper_id
    LEFT JOIN users cb ON cb.id = o.created_by`;

function present(o: any) {
  return { ...o, work_seconds: Math.round(Number(o.work_seconds)), total_cost: Number(o.total_cost) };
}

async function loadOrder(id: number) {
  const o = await one(`${BASE} WHERE o.id = $1`, [id]);
  if (!o) throw notFound('Ordem de serviço não encontrada.');
  return present(o);
}

async function orderFromRequest(req: FastifyRequest) {
  const user = requireOsUser(req);
  const { id } = parse(idParam, req.params);
  const order = await loadOrder(id);
  if (!canSee(user, order)) throw forbidden('Você não tem acesso a esta ordem de serviço.');
  return { user, order };
}

type Db = Pick<pg.PoolClient, 'query'>;

async function event(db: Db, orderId: number, user: AuthUser, kind: string, details?: Record<string, unknown>) {
  await db.query('INSERT INTO service_order_events(order_id, user_id, username, kind, details) VALUES ($1,$2,$3,$4,$5)', [
    orderId, user.id, user.name, kind, details ? JSON.stringify(details) : null,
  ]);
}

async function stopClock(db: Db, orderId: number) {
  await db.query('UPDATE service_order_time SET ended_at = now() WHERE order_id = $1 AND ended_at IS NULL', [orderId]);
}

const label = (o: { id: number; title: string }) => `OS #${o.id} · ${o.title}`;

async function validateAssignee(userId: number | null, what = 'O responsável escolhido') {
  if (userId == null) return null;
  const u = await one(`SELECT u.id, u.name, u.role, u.permissions_grant, u.permissions_revoke,${userGroupColumns('u')} FROM users u WHERE u.id = $1 AND u.active`, [userId]);
  if (!u || !effectivePermissions(u.role, u.permissions_grant, u.permissions_revoke, u.group_permissions).has('os.execute')) {
    throw badRequest(`${what} não pode executar ordens de serviço.`);
  }
  return u as { id: number; name: string };
}

function decodeImage(b64: string, max: number, what: string): { buf: Buffer; mime: string } {
  const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > max) throw badRequest(`${what} muito grande ou vazia.`);
  let mime: string | null = null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
  else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') mime = 'image/webp';
  if (!mime) throw badRequest(`${what}: formato não suportado (use JPEG, PNG ou WebP).`);
  return { buf, mime };
}

// ------------------------------------------------------------------ rotas

export async function serviceOrderRoutes(app: FastifyInstance) {
  app.get('/api/os', async (req) => {
    const user = requireOsUser(req);
    const qs = parse(z.object({
      status: z.string().default('ativas'),
      mine: z.enum(['1', '0']).default('0'),
      assigned: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(100).optional(),
    }), req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!seesAll(user) || qs.mine === '1') {
      params.push(user.id);
      where.push(`(o.assigned_to = $${params.length} OR o.helper_id = $${params.length})`);
    } else if (!user.allClients) {
      params.push(user.clientIds, user.id);
      where.push(`(o.client_id IS NULL OR o.client_id = ANY($${params.length - 1}::int[]) OR o.assigned_to = $${params.length} OR o.helper_id = $${params.length})`);
    }
    if (qs.assigned && seesAll(user)) {
      params.push(qs.assigned);
      where.push(`(o.assigned_to = $${params.length} OR o.helper_id = $${params.length})`);
    }
    if (qs.q) {
      params.push(`%${qs.q}%`, qs.q.replace(/^#/, ''));
      const n = params.length - 1;
      where.push(`(o.title ILIKE $${n} OR o.description ILIKE $${n} OR c.name ILIKE $${n} OR o.location ILIKE $${n} OR o.id::text = $${n + 1})`);
    }
    const scopeWhere = where.length ? where.join(' AND ') : 'TRUE';
    // Contagem por situação (abas) antes do filtro de situação.
    const counts = await query(`SELECT o.status, count(*)::int AS n FROM service_orders o LEFT JOIN clients c ON c.id = o.client_id WHERE ${scopeWhere} GROUP BY o.status`, params);
    const statusFilter = qs.status === 'ativas' ? `o.status = ANY('{aberta,em_andamento,pausada}')`
      : qs.status === 'todas' ? 'TRUE'
      : (() => { params.push(qs.status); return `o.status = $${params.length}`; })();
    const rows = await query(
      `${BASE} WHERE ${scopeWhere} AND ${statusFilter}
        ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'aberta' THEN 2 ELSE 3 END,
                 CASE WHEN o.status IN ('concluida','cancelada') THEN 0 ELSE array_position(ARRAY['urgente','alta','normal','baixa'], o.priority) END,
                 CASE WHEN o.status IN ('concluida','cancelada') THEN NULL ELSE COALESCE(o.scheduled_for, o.created_at) END ASC NULLS LAST,
                 COALESCE(o.finished_at, o.updated_at) DESC
        LIMIT 500`,
      params,
    );
    return { rows: rows.map(present), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  /** Usuários que podem receber ordens (ativos e com permissão de executar). */
  async function executors() {
    const users = await query(`SELECT u.id, u.name, u.username, u.role, u.permissions_grant, u.permissions_revoke, u.avatar_updated_at,${userGroupColumns('u')} FROM users u WHERE u.active ORDER BY u.name`);
    const open = await query(
      `SELECT u AS user_id, count(*)::int AS n FROM service_orders, unnest(ARRAY[assigned_to, helper_id]) AS u
        WHERE status = ANY('{aberta,em_andamento,pausada}') AND u IS NOT NULL GROUP BY u`,
    );
    const load = new Map(open.map((r) => [r.user_id, r.n]));
    return users
      .filter((u) => effectivePermissions(u.role, u.permissions_grant, u.permissions_revoke, u.group_permissions).has('os.execute'))
      .map((u) => ({ id: u.id, name: u.name, username: u.username, avatar_updated_at: u.avatar_updated_at, open: load.get(u.id) ?? 0 }));
  }

  app.get('/api/os/assignees', async (req) => {
    requirePerm(req, 'os.manage');
    return executors();
  });

  /** Técnicos que o responsável pode chamar como companheiro nesta ordem. */
  app.get('/api/os/:id/helper-options', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!isPrincipal(user, order) && !hasPerm(user, 'os.manage')) throw forbidden();
    return (await executors()).filter((u) => u.id !== order.assigned_to);
  });

  app.get('/api/os/:id', async (req) => {
    const { user, order } = await orderFromRequest(req);
    const [items, photos, events] = await Promise.all([
      query('SELECT i.id, i.kind, i.description, i.quantity::float8 AS quantity, i.unit, i.store, i.amount::float8 AS amount, i.created_at, u.name AS created_by_name FROM service_order_items i LEFT JOIN users u ON u.id = i.created_by WHERE i.order_id = $1 ORDER BY i.id', [order.id]),
      query('SELECT p.id, p.caption, p.size, p.created_at, p.uploaded_by, u.name AS uploaded_by_name FROM service_order_photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.order_id = $1 ORDER BY p.id', [order.id]),
      query('SELECT id, at, username, kind, details FROM service_order_events WHERE order_id = $1 ORDER BY at, id', [order.id]),
    ]);
    const manage = hasPerm(user, 'os.manage');
    const mine = order.assigned_to === user.id ? 'assigned' : order.helper_id === user.id ? 'helper' : null;
    return {
      ...order, items, photos, events,
      can: {
        manage,
        execute: isExecutor(user, order),
        principal: isPrincipal(user, order),
        work: canWork(user, order),
        edit: manage && OPEN.includes(order.status),
        setHelper: OPEN.includes(order.status) && !!order.assigned_to && (isPrincipal(user, order) || manage),
        deletePhotoOf: manage ? 'all' : 'own',
        /** Já confirmou a finalização (ordens com dois técnicos). */
        confirmed: mine === 'assigned' ? !!order.assigned_done_at : mine === 'helper' ? !!order.helper_done_at : false,
      },
    };
  });

  app.post('/api/os', async (req) => {
    const user = requirePerm(req, 'os.manage');
    const b = parse(orderSchema, req.body);
    if (b.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    const assignee = await validateAssignee(b.assigned_to);
    const helper = await validateAssignee(b.helper_id, 'O técnico auxiliar');
    const o = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO service_orders(title, description, client_id, location, contacts, priority, assigned_to, helper_id, scheduled_for, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, title, client_id`,
        [b.title, b.description, b.client_id, b.location, JSON.stringify(b.contacts), b.priority, b.assigned_to, b.helper_id, b.scheduled_for, user.id],
      );
      const row = r.rows[0];
      await event(c, row.id, user, 'criada', assignee ? { assigned: assignee.name, helper: helper?.name ?? null } : undefined);
      return row;
    });
    await audit(req, { action: 'os.create', clientId: o.client_id, target: label(o), details: { assigned: assignee?.name ?? null, priority: b.priority } });
    return loadOrder(o.id);
  });

  app.put('/api/os/:id', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!hasPerm(user, 'os.manage')) throw forbidden();
    if (!OPEN.includes(order.status)) throw badRequest('Ordem concluída ou cancelada não pode ser editada. Reabra-a primeiro.');
    const b = parse(orderSchema, req.body);
    if (b.client_id && b.client_id !== order.client_id && !canAccessClient(user, b.client_id)) throw forbidden('Você não tem acesso a esse cliente.');
    const reassigned = b.assigned_to !== order.assigned_to;
    const helperChanged = b.helper_id !== order.helper_id;
    const assignee = reassigned ? await validateAssignee(b.assigned_to) : null;
    const helper = helperChanged ? await validateAssignee(b.helper_id, 'O técnico auxiliar') : null;
    await tx(async (c) => {
      // Troca de responsável com o cronômetro rodando: encerra o período atual e deixa a ordem pausada.
      const pause = reassigned && order.status === 'em_andamento';
      if (pause) await stopClock(c, order.id);
      // Mudou a equipe: as confirmações de finalização recomeçam.
      await c.query(
        `UPDATE service_orders SET title=$2, description=$3, client_id=$4, location=$5, contacts=$6, priority=$7, assigned_to=$8, helper_id=$9, scheduled_for=$10,
                status = CASE WHEN $11 THEN 'pausada' ELSE status END,
                assigned_done_at = CASE WHEN $12 THEN NULL ELSE assigned_done_at END,
                helper_done_at = CASE WHEN $12 THEN NULL ELSE helper_done_at END,
                updated_at = now() WHERE id = $1`,
        [order.id, b.title, b.description, b.client_id, b.location, JSON.stringify(b.contacts), b.priority, b.assigned_to, b.helper_id, b.scheduled_for, pause, reassigned || helperChanged],
      );
      if (reassigned) await event(c, order.id, user, 'atribuida', { from: order.assigned_name, to: assignee?.name ?? null });
      if (helperChanged) await event(c, order.id, user, 'auxiliar', { from: order.helper_name, to: helper?.name ?? null });
      if (!reassigned && !helperChanged) await event(c, order.id, user, 'editada');
    });
    await audit(req, { action: reassigned ? 'os.assign' : 'os.update', clientId: b.client_id, target: label({ id: order.id, title: b.title }), details: reassigned ? { from: order.assigned_name, to: assignee?.name ?? null } : null });
    return loadOrder(order.id);
  });

  app.post('/api/os/:id/helper', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!isPrincipal(user, order) && !hasPerm(user, 'os.manage')) throw forbidden('Somente o técnico responsável ou quem gerencia pode definir o companheiro.');
    if (!OPEN.includes(order.status)) throw badRequest('A ordem já foi encerrada.');
    if (!order.assigned_to) throw badRequest('Atribua um técnico responsável antes.');
    const b = parse(z.object({ helper_id: z.number().int().positive().nullable() }), req.body);
    if (b.helper_id === order.assigned_to) throw badRequest('O companheiro deve ser outro técnico.');
    const helper = await validateAssignee(b.helper_id, 'O companheiro escolhido');
    await tx(async (c) => {
      await c.query('UPDATE service_orders SET helper_id=$2, assigned_done_at=NULL, helper_done_at=NULL, updated_at=now() WHERE id=$1', [order.id, b.helper_id]);
      await event(c, order.id, user, 'auxiliar', { from: order.helper_name, to: helper?.name ?? null });
    });
    await audit(req, { action: 'os.helper', clientId: order.client_id, target: label(order), details: { from: order.helper_name, to: helper?.name ?? null } });
    return loadOrder(order.id);
  });

  // ---- execução (técnicos da ordem)

  app.post('/api/os/:id/start', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!isExecutor(user, order)) throw forbidden('Somente os técnicos da ordem podem iniciá-la.');
    if (!['aberta', 'pausada'].includes(order.status)) throw badRequest('A ordem não está aguardando início.');
    const running = await one(
      `SELECT id FROM service_orders WHERE (assigned_to = $1 OR helper_id = $1) AND status = 'em_andamento' AND id <> $2`,
      [user.id, order.id],
    );
    if (running) throw conflict(`Você já está com a OS #${running.id} em andamento. Pause-a antes de iniciar outra.`);
    await tx(async (c) => {
      await c.query('INSERT INTO service_order_time(order_id, user_id) VALUES ($1,$2)', [order.id, user.id]);
      // Voltou a trabalhar: confirmações de finalização anteriores deixam de valer.
      await c.query(
        `UPDATE service_orders SET status = 'em_andamento', started_at = COALESCE(started_at, now()), assigned_done_at = NULL, helper_done_at = NULL, updated_at = now() WHERE id = $1`,
        [order.id],
      );
      await event(c, order.id, user, order.started_at ? 'retomada' : 'iniciada');
    });
    return loadOrder(order.id);
  });

  app.post('/api/os/:id/pause', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!isExecutor(user, order) && !hasPerm(user, 'os.manage')) throw forbidden();
    if (order.status !== 'em_andamento') throw badRequest('A ordem não está em andamento.');
    await tx(async (c) => {
      await stopClock(c, order.id);
      await c.query(`UPDATE service_orders SET status = 'pausada', updated_at = now() WHERE id = $1`, [order.id]);
      await event(c, order.id, user, 'pausada');
    });
    return loadOrder(order.id);
  });

  app.put('/api/os/:id/report', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!canWork(user, order)) throw forbidden('Você não pode alterar o relatório desta ordem.');
    const b = parse(reportSchema, req.body);
    await query('UPDATE service_orders SET report = $2, updated_at = now() WHERE id = $1', [order.id, b.report || null]);
    return { ok: true };
  });

  app.post('/api/os/:id/finish', async (req) => {
    const { user, order } = await orderFromRequest(req);
    const duo = !!order.helper_id;
    // Em dupla, cada técnico confirma a própria parte; sem auxiliar, o responsável ou quem gerencia conclui.
    if (duo ? !isExecutor(user, order) : !isExecutor(user, order) && !hasPerm(user, 'os.manage')) {
      throw forbidden(duo ? 'Esta ordem tem dois técnicos: cada um deles confirma a finalização.' : 'Somente o técnico responsável pode finalizar esta ordem.');
    }
    if (!['em_andamento', 'pausada'].includes(order.status)) throw badRequest(order.status === 'aberta' ? 'Inicie a ordem antes de finalizar.' : 'A ordem já foi encerrada.');
    const b = parse(z.object({ report: z.string().trim().max(10000).optional() }), req.body);
    const report = b.report || order.report;
    if (!report || report.trim().length < 5) throw badRequest('Descreva o que foi feito.');
    const role = order.assigned_to === user.id ? 'assigned' : order.helper_id === user.id ? 'helper' : null;
    const assignedDone = !duo || role === 'assigned' || !!order.assigned_done_at;
    const helperDone = !duo || role === 'helper' || !!order.helper_done_at;
    const complete = assignedDone && helperDone;
    await tx(async (c) => {
      await stopClock(c, order.id);
      await c.query(
        `UPDATE service_orders SET report = $2,
                assigned_done_at = CASE WHEN $3 THEN COALESCE(assigned_done_at, now()) ELSE assigned_done_at END,
                helper_done_at = CASE WHEN $4 THEN COALESCE(helper_done_at, now()) ELSE helper_done_at END,
                status = CASE WHEN $5 THEN 'concluida' ELSE 'pausada' END,
                finished_at = CASE WHEN $5 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
        [order.id, report, duo && role === 'assigned', duo && role === 'helper', complete],
      );
      if (duo) await event(c, order.id, user, 'finalizacao_confirmada');
      if (complete) await event(c, order.id, user, 'concluida');
    });
    const done = await loadOrder(order.id);
    if (complete) await audit(req, { action: 'os.finish', clientId: order.client_id, target: label(order), details: { work_seconds: done.work_seconds, total_cost: done.total_cost } });
    return done;
  });

  // ---- gestão

  app.post('/api/os/:id/reopen', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!hasPerm(user, 'os.manage')) throw forbidden();
    if (!['concluida', 'cancelada'].includes(order.status)) throw badRequest('A ordem não está encerrada.');
    const next = order.started_at ? 'pausada' : 'aberta';
    await tx(async (c) => {
      await c.query(
        `UPDATE service_orders SET status = $2, finished_at = NULL, cancel_reason = NULL, assigned_done_at = NULL, helper_done_at = NULL, updated_at = now() WHERE id = $1`,
        [order.id, next],
      );
      await event(c, order.id, user, 'reaberta');
    });
    await audit(req, { action: 'os.reopen', clientId: order.client_id, target: label(order) });
    return loadOrder(order.id);
  });

  app.post('/api/os/:id/cancel', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!hasPerm(user, 'os.manage')) throw forbidden();
    if (!OPEN.includes(order.status)) throw badRequest('A ordem já foi encerrada.');
    const b = parse(z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(1000) }), req.body);
    await tx(async (c) => {
      await stopClock(c, order.id);
      await c.query(`UPDATE service_orders SET status = 'cancelada', cancel_reason = $2, updated_at = now() WHERE id = $1`, [order.id, b.reason]);
      await event(c, order.id, user, 'cancelada', { reason: b.reason });
    });
    await audit(req, { action: 'os.cancel', clientId: order.client_id, target: label(order), details: { reason: b.reason } });
    return loadOrder(order.id);
  });

  // ---- gastos

  app.post('/api/os/:id/items', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!canWork(user, order)) throw forbidden('Você não pode lançar gastos nesta ordem.');
    const b = parse(itemSchema, req.body);
    await tx(async (c) => {
      if (b.kind === 'material') {
        await c.query('INSERT INTO service_order_items(order_id, kind, description, quantity, unit, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [order.id, b.kind, b.description, b.quantity, b.unit, user.id]);
        await event(c, order.id, user, 'gasto', { kind: b.kind, description: b.description, quantity: b.quantity, unit: b.unit });
      } else {
        await c.query('INSERT INTO service_order_items(order_id, kind, description, store, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [order.id, b.kind, b.description, b.store, b.amount, user.id]);
        await event(c, order.id, user, 'gasto', { kind: b.kind, description: b.description, store: b.store, amount: b.amount });
      }
    });
    return { ok: true };
  });

  app.delete('/api/os/:id/items/:itemId', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!canWork(user, order)) throw forbidden('Você não pode alterar os gastos desta ordem.');
    const { itemId } = parse(subId('itemId'), req.params);
    await tx(async (c) => {
      const r = await c.query('DELETE FROM service_order_items WHERE id = $1 AND order_id = $2 RETURNING description', [itemId, order.id]);
      if (!r.rows[0]) throw notFound('Item não encontrado.');
      await event(c, order.id, user, 'gasto_removido', { description: r.rows[0].description });
    });
    return { ok: true };
  });

  // ---- fotos

  app.post('/api/os/:id/photos', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!canWork(user, order)) throw forbidden('Você não pode enviar fotos para esta ordem.');
    const b = parse(photoSchema, req.body);
    const img = decodeImage(b.image, MAX_PHOTO_BYTES, 'Foto');
    const th = decodeImage(b.thumb, MAX_THUMB_BYTES, 'Miniatura');
    const n = await one('SELECT count(*)::int AS n FROM service_order_photos WHERE order_id = $1', [order.id]);
    if (n.n >= MAX_PHOTOS) throw badRequest(`Limite de ${MAX_PHOTOS} fotos por ordem atingido.`);
    const p = await tx(async (c) => {
      const r = await c.query(
        'INSERT INTO service_order_photos(order_id, caption, mime, size, data, thumb, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [order.id, b.caption, img.mime, img.buf.length, img.buf, th.buf, user.id],
      );
      await event(c, order.id, user, 'foto', b.caption ? { caption: b.caption } : undefined);
      return r.rows[0];
    });
    return { id: p.id };
  });

  app.get('/api/os/:id/photos/:photoId', async (req, reply) => {
    const { order } = await orderFromRequest(req);
    const { photoId } = parse(subId('photoId'), req.params);
    const thumb = (req.query as { thumb?: string })?.thumb === '1';
    const p = await one(`SELECT mime, ${thumb ? 'thumb' : 'data'} AS bytes FROM service_order_photos WHERE id = $1 AND order_id = $2`, [photoId, order.id]);
    if (!p) throw notFound('Foto não encontrada.');
    reply.header('Content-Type', thumb ? 'image/jpeg' : p.mime);
    reply.header('Content-Disposition', `inline; filename="os-${order.id}-foto-${photoId}.${thumb ? 'jpg' : p.mime.split('/')[1]}"`);
    return reply.send(p.bytes);
  });

  app.delete('/api/os/:id/photos/:photoId', async (req) => {
    const { user, order } = await orderFromRequest(req);
    if (!canWork(user, order)) throw forbidden('Você não pode remover fotos desta ordem.');
    const { photoId } = parse(subId('photoId'), req.params);
    const p = await one('SELECT uploaded_by FROM service_order_photos WHERE id = $1 AND order_id = $2', [photoId, order.id]);
    if (!p) throw notFound('Foto não encontrada.');
    if (p.uploaded_by !== user.id && !hasPerm(user, 'os.manage')) throw forbidden('Você só pode remover as fotos que enviou.');
    await tx(async (c) => {
      await c.query('DELETE FROM service_order_photos WHERE id = $1', [photoId]);
      await event(c, order.id, user, 'foto_removida');
    });
    return { ok: true };
  });
}
