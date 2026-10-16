/**
 * PostgreSQL embutido (PGlite) para desenvolvimento local sem Docker.
 * Uso: npm run dev:db   (porta 54330, dados em ./.devdb). Aceita uma conexão por vez: use DB_POOL_MAX=1.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// O pglite-socket não trata quedas de conexão (ex.: backend reiniciado pelo tsx watch).
process.on('uncaughtException', (e: NodeJS.ErrnoException) => {
  if (e.code === 'ECONNRESET' || e.code === 'EPIPE') console.warn(`Conexão do cliente encerrada (${e.code}); aguardando nova conexão.`);
  else throw e;
});

const port = Number(process.env.DEV_DB_PORT ?? 54330);
const db = await PGlite.create({ dataDir: './.devdb' });
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`PGlite ouvindo em postgres://postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
