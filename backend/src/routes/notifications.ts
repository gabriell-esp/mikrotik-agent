import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { secretBox } from '../lib/secrets.js';
import { idParam, parse } from '../lib/validate.js';
import { requirePerm } from '../auth/session.js';
import { audit } from '../services/audit.js';
import { NOTIFY_EVENT_KEYS, NOTIFY_EVENTS, sendLogged } from '../services/notifier.js';
import {
  getWhatsappSettings, normalizeGroup, normalizePhone, saveWhatsappSettings, whatsappClient, WhatsappError, WppClient,
} from '../services/whatsapp.js';

const settingsSchema = z.object({
  enabled: z.boolean(),
  base_url: z.string().trim().url('URL inválida (ex.: http://wppconnect:21465)').max(300),
  session: z.string().trim().regex(/^[A-Za-z0-9_-]{1,50}$/, 'Use letras, números, hífen ou sublinhado'),
  secret_key: z.string().max(300).optional(),
  delay_sec: z.coerce.number().int().min(0).max(3600),
  resource_threshold: z.coerce.number().int().min(50).max(100),
});

const recipientSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(100),
    target: z.string().trim().min(5, 'Informe o número ou o grupo').max(100),
    is_group: z.boolean().default(false),
    enabled: z.boolean().default(true),
    events: z.array(z.enum(NOTIFY_EVENT_KEYS as [string, ...string[]])).min(1, 'Selecione ao menos um evento'),
    client_ids: z.array(z.number().int().positive()).nullable().default(null),
  })
  .transform((r) => ({ ...r, target: r.is_group ? normalizeGroup(r.target) : normalizePhone(r.target) }))
  .refine((r) => r.is_group ? /^[\d-]{5,40}$/.test(r.target) : /^\d{12,15}$/.test(r.target), {
    message: 'Número inválido: use DDD + número (ex.: 11 91234-5678) ou DDI completo',
    path: ['target'],
  });

/** Erros do WPPConnect viram 502 com mensagem clara. */
async function wa<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WhatsappError) throw new AppError(502, 'whatsapp', e.message);
    throw e;
  }
}

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications/settings', async (req) => {
    requirePerm(req, 'notifications.manage');
    const { secret_key_enc, token_enc, ...s } = await getWhatsappSettings();
    return { ...s, has_secret_key: !!secret_key_enc, has_token: !!token_enc, events: NOTIFY_EVENTS };
  });

  app.put('/api/notifications/settings', async (req) => {
    requirePerm(req, 'notifications.manage');
    const b = parse(settingsSchema, req.body);
    const cur = await getWhatsappSettings();
    const secretChanged = !!b.secret_key;
    const connChanged = secretChanged || b.base_url !== cur.base_url || b.session !== cur.session;
    await saveWhatsappSettings({
      enabled: b.enabled,
      base_url: b.base_url,
      session: b.session,
      delay_sec: b.delay_sec,
      resource_threshold: b.resource_threshold,
      secret_key_enc: secretChanged ? secretBox().encrypt(b.secret_key!) : cur.secret_key_enc,
      token_enc: connChanged ? null : cur.token_enc, // novo servidor/sessão/chave exige novo token
    });
    await audit(req, { action: 'notifications.settings', details: { enabled: b.enabled, base_url: b.base_url, session: b.session, delay_sec: b.delay_sec, resource_threshold: b.resource_threshold, chave_alterada: secretChanged } });
    return { ok: true };
  });

  app.get('/api/notifications/whatsapp/status', async (req) => {
    requirePerm(req, 'notifications.manage');
    const c = await whatsappClient();
    if (!c.configured) return { configured: false, connected: false, status: 'NOT_CONFIGURED', qrcode: null };
    try {
      return { configured: true, ...(await c.status()) };
    } catch (e) {
      if (e instanceof WhatsappError) return { configured: true, connected: false, status: 'ERROR', qrcode: null, error: e.message };
      throw e;
    }
  });

  app.post('/api/notifications/whatsapp/start', async (req) => {
    requirePerm(req, 'notifications.manage');
    const c = await whatsappClient();
    if (!c.configured) throw badRequest('Configure a URL, a sessão e a chave secreta do WPPConnect antes de conectar.');
    await wa(() => c.start());
    await audit(req, { action: 'notifications.whatsapp.start' });
    // O QR é gerado de forma assíncrona; a tela consulta o status em seguida.
    return wa(() => c.status());
  });

  app.post('/api/notifications/whatsapp/logout', async (req) => {
    requirePerm(req, 'notifications.manage');
    const c = await whatsappClient();
    await wa(() => c.logout());
    await audit(req, { action: 'notifications.whatsapp.logout' });
    return { ok: true };
  });

  app.get('/api/notifications/whatsapp/groups', async (req) => {
    requirePerm(req, 'notifications.manage');
    const c = await whatsappClient();
    return wa(() => c.groups());
  });

  app.post('/api/notifications/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = requirePerm(req, 'notifications.manage');
    const b = parse(z.object({ recipient_id: z.number().int().positive() }), req.body);
    const r = await one('SELECT * FROM notification_recipients WHERE id = $1', [b.recipient_id]);
    if (!r) throw notFound('Destinatário não encontrado.');
    const c: WppClient = await whatsappClient();
    if (!c.configured) throw badRequest('WhatsApp não configurado.');
    const msg = `✅ *Teste de notificação*\n\nEste ${r.is_group ? 'grupo' : 'número'} receberá os alertas do monitoramento das MikroTiks.\nEnviado por ${user.name}.\n\n_Slot1 · Gerência MikroTik_`;
    const res = await sendLogged(c, r, msg, { events: ['test'], device_ids: [] });
    await audit(req, { action: 'notifications.test', target: r.name, success: res.ok, details: res.ok ? null : { erro: res.error } });
    if (!res.ok) throw new AppError(502, 'whatsapp', `Falha no envio: ${res.error}`);
    return { ok: true };
  });

  app.get('/api/notifications/recipients', async (req) => {
    requirePerm(req, 'notifications.manage');
    return query('SELECT * FROM notification_recipients ORDER BY name');
  });

  app.post('/api/notifications/recipients', async (req) => {
    requirePerm(req, 'notifications.manage');
    const b = parse(recipientSchema, req.body);
    if (await one('SELECT 1 FROM notification_recipients WHERE target = $1', [b.target])) throw conflict('Esse número/grupo já está cadastrado.');
    const r = await one(
      `INSERT INTO notification_recipients(name, target, is_group, enabled, events, client_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.name, b.target, b.is_group, b.enabled, b.events, b.client_ids],
    );
    await audit(req, { action: 'notifications.recipient.create', target: b.name, details: { target: b.target, is_group: b.is_group, events: b.events, client_ids: b.client_ids } });
    return r;
  });

  app.put('/api/notifications/recipients/:id', async (req) => {
    requirePerm(req, 'notifications.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(recipientSchema, req.body);
    if (await one('SELECT 1 FROM notification_recipients WHERE target = $1 AND id <> $2', [b.target, id])) throw conflict('Esse número/grupo já está cadastrado.');
    const r = await one(
      `UPDATE notification_recipients SET name=$2, target=$3, is_group=$4, enabled=$5, events=$6, client_ids=$7, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, b.name, b.target, b.is_group, b.enabled, b.events, b.client_ids],
    );
    if (!r) throw notFound('Destinatário não encontrado.');
    await audit(req, { action: 'notifications.recipient.update', target: b.name, details: { target: b.target, enabled: b.enabled, events: b.events, client_ids: b.client_ids } });
    return r;
  });

  app.delete('/api/notifications/recipients/:id', async (req) => {
    requirePerm(req, 'notifications.manage');
    const { id } = parse(idParam, req.params);
    const r = await one('DELETE FROM notification_recipients WHERE id = $1 RETURNING name', [id]);
    if (!r) throw notFound('Destinatário não encontrado.');
    await audit(req, { action: 'notifications.recipient.delete', target: r.name });
    return { ok: true };
  });

  app.get('/api/notifications/log', async (req) => {
    requirePerm(req, 'notifications.manage');
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(10).max(100).default(25) }), req.query);
    const total = (await one('SELECT count(*)::int AS n FROM notification_log')).n;
    const rows = await query('SELECT * FROM notification_log ORDER BY at DESC LIMIT $1 OFFSET $2', [q.page_size, (q.page - 1) * q.page_size]);
    return { total, page: q.page, page_size: q.page_size, rows };
  });
}
