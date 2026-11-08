import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { secretBox } from './lib/secrets.js';
import { startCollector } from './services/collector.js';
import { startUserCleanup } from './services/user-cleanup.js';

async function main() {
  secretBox(); // falha cedo se a chave mestra estiver ausente ou inválida
  const app = await buildApp();
  await migrate((m) => app.log.info(m));
  const stopCollector = config.collectorEnabled ? startCollector(app.log) : () => {};
  const stopCleanup = startUserCleanup(app.log);
  const stop = () => {
    stopCollector();
    stopCleanup();
  };
  const shutdown = async () => {
    stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ host: config.host, port: config.port });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
