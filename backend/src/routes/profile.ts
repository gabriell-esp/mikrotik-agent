import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.js';
import { one, query } from '../db/pool.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';

const MAX_AVATAR = 300 * 1024;

/** Telefone brasileiro só com dígitos (DDD + número, com ou sem 55). */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => /^(55)?\d{10,11}$/.test(v), 'Telefone inválido: informe DDD + número');

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(100),
  email: z.string().trim().email('E-mail inválido').max(200).optional().nullable().or(z.literal('')),
  phone: z.union([phoneSchema, z.literal(''), z.null()]).optional().transform((v) => v || null),
});

/** Perfil do próprio usuário: nome, e-mail, telefone e foto. */
export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async (req) => {
    const u = requireUser(req);
    return one('SELECT id, username, name, email, phone, role, avatar_updated_at, last_login_at, created_at FROM users WHERE id = $1', [u.id]);
  });

  app.put('/api/profile', async (req) => {
    const u = requireUser(req);
    const b = parse(profileSchema, req.body);
    return one(
      'UPDATE users SET name=$2, email=$3, phone=$4, updated_at=now() WHERE id=$1 RETURNING id, username, name, email, phone, role, avatar_updated_at',
      [u.id, b.name, b.email || null, b.phone],
    );
  });

  app.put('/api/profile/avatar', { bodyLimit: 1024 * 1024 }, async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ image: z.string().min(10).max(600 * 1024) }), req.body);
    const buf = Buffer.from(b.image.replace(/^data:[^,]*,/, ''), 'base64');
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw badRequest('A foto deve ser enviada em JPEG.');
    if (buf.length > MAX_AVATAR) throw badRequest('Foto muito grande.');
    const r = await one('UPDATE users SET avatar=$2, avatar_updated_at=now() WHERE id=$1 RETURNING avatar_updated_at', [u.id, buf]);
    return { avatar_updated_at: r.avatar_updated_at };
  });

  app.delete('/api/profile/avatar', async (req) => {
    const u = requireUser(req);
    await query('UPDATE users SET avatar=NULL, avatar_updated_at=NULL WHERE id=$1', [u.id]);
    return { ok: true };
  });

  /** Foto de qualquer usuário (para quem está logado). A URL leva a versão, então pode ficar em cache. */
  app.get('/api/users/:id/avatar', async (req, reply) => {
    requireUser(req);
    const { id } = parse(idParam, req.params);
    const r = await one('SELECT avatar FROM users WHERE id = $1 AND avatar IS NOT NULL', [id]);
    if (!r) throw notFound('Sem foto.');
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=604800');
    return reply.send(r.avatar);
  });
}
