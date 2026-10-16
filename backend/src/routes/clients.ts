import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { idParam, optionalText, parse } from '../lib/validate.js';
import { canAccessClient, clientScopeSql, requirePerm } from '../auth/session.js';
import { audit } from '../services/audit.js';

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente').max(150),
  document: optionalText(30),
  contact: optionalText(100),
  phone: optionalText(30),
  email: optionalText(200),
  notes: optionalText(2000),
  active: z.boolean().default(true),
});

export async function clientRoutes(app: FastifyInstance) {
  app.get('/api/clients', async (req) => {
    const user = requirePerm(req, 'clients.view');
    const params: unknown[] = [];
    const scope = clientScopeSql(user, 'c', params);
    return query(
      `SELECT c.*,
              count(d.id)::int AS devices,
              count(d.id) FILTER (WHERE d.status = 'online')::int AS online,
              count(d.id) FILTER (WHERE d.status IN ('unreachable','auth_failed','error'))::int AS problems
         FROM clients c LEFT JOIN devices d ON d.client_id = c.id
        WHERE ${scope} GROUP BY c.id ORDER BY c.name`,
      params,
    );
  });

  app.get('/api/clients/:id', async (req) => {
    const user = requirePerm(req, 'clients.view');
    const { id } = parse(idParam, req.params);
    if (!canAccessClient(user, id)) throw forbidden();
    const c = await one('SELECT * FROM clients WHERE id = $1', [id]);
    if (!c) throw notFound('Cliente não encontrado.');
    return c;
  });

  app.post('/api/clients', async (req) => {
    requirePerm(req, 'clients.manage');
    const b = parse(clientSchema, req.body);
    if (await one('SELECT 1 FROM clients WHERE lower(name) = lower($1)', [b.name])) throw conflict('Já existe um cliente com esse nome.');
    const c = await one(
      `INSERT INTO clients(name, document, contact, phone, email, notes, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name, b.document, b.contact, b.phone, b.email, b.notes, b.active],
    );
    await audit(req, { action: 'client.create', clientId: c.id, target: c.name });
    return c;
  });

  app.put('/api/clients/:id', async (req) => {
    requirePerm(req, 'clients.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(clientSchema, req.body);
    if (await one('SELECT 1 FROM clients WHERE lower(name) = lower($1) AND id <> $2', [b.name, id])) throw conflict('Já existe um cliente com esse nome.');
    const c = await one(
      `UPDATE clients SET name=$2, document=$3, contact=$4, phone=$5, email=$6, notes=$7, active=$8, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, b.name, b.document, b.contact, b.phone, b.email, b.notes, b.active],
    );
    if (!c) throw notFound('Cliente não encontrado.');
    await audit(req, { action: 'client.update', clientId: id, target: c.name });
    return c;
  });

  app.delete('/api/clients/:id', async (req) => {
    requirePerm(req, 'clients.manage');
    const { id } = parse(idParam, req.params);
    const n = await one('SELECT count(*)::int AS n FROM devices WHERE client_id = $1', [id]);
    if (n.n > 0) throw badRequest('Cliente possui equipamentos cadastrados. Remova ou transfira os equipamentos antes.');
    const c = await one('DELETE FROM clients WHERE id = $1 RETURNING name', [id]);
    if (!c) throw notFound('Cliente não encontrado.');
    await audit(req, { action: 'client.delete', target: c.name });
    return { ok: true };
  });
}
