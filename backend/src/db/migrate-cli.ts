import { migrate } from './migrate.js';
import { pool } from './pool.js';

migrate()
  .then(() => console.log('Migrações concluídas.'))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
