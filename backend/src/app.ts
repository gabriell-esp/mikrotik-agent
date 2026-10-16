import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { resolveUser } from './auth/session.js';
import { AppError } from './lib/errors.js';
import { RosError } from './routeros/types.js';
import { authRoutes } from './routes/auth.js';
import { auditRoutes } from './routes/audit.js';
import { clientRoutes } from './routes/clients.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/devices.js';
import { notificationRoutes } from './routes/notifications.js';
import { pppoeRoutes } from './routes/pppoe.js';
import { userRoutes } from './routes/users.js';
import { wireguardRoutes } from './routes/wireguard.js';

const ROS_HTTP_STATUS: Record<string, number> = {
  unreachable: 502, refused: 502, tls: 502, timeout: 504, protocol: 502,
  auth: 502, permission: 502, unsupported: 422, command: 422, config: 500,
};

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (req, reply) => {
    await resolveUser(req);
    // Proteção CSRF complementar ao SameSite=Strict: requisições de escrita precisam do cabeçalho da SPA.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'slot1') {
      return reply.code(403).send({ error: 'csrf', message: 'Requisição recusada (cabeçalho ausente).' });
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof RosError) {
      return reply.code(ROS_HTTP_STATUS[err.kind] ?? 502).send({ error: `ros_${err.kind}`, message: err.message, method: err.method });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'request', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Erro interno. Consulte os logs do servidor.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(clientRoutes);
  await app.register(deviceRoutes);
  await app.register(wireguardRoutes);
  await app.register(dashboardRoutes);
  await app.register(pppoeRoutes);
  await app.register(auditRoutes);
  await app.register(notificationRoutes);

  return app;
}
