/**
 * Cria (ou redefine a senha de) um administrador.
 * Uso: npm run create-admin -- <login> "<Nome>"   (a senha é lida de ADMIN_PASSWORD ou gerada)
 */
import { randomBytes } from 'node:crypto';
import { migrate } from '../db/migrate.js';
import { one, pool, query } from '../db/pool.js';
import { hashPassword } from '../lib/crypto.js';

async function main() {
  const [username = 'admin', name = 'Administrador'] = process.argv.slice(2);
  const login = username.toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw new Error('Login inválido.');
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url') + '1a';
  await migrate(() => {});
  const hash = await hashPassword(password);
  const existing = await one('SELECT id FROM users WHERE username = $1', [login]);
  if (existing) {
    await query(`UPDATE users SET password_hash=$2, role='admin', active=TRUE, must_change_password=TRUE, failed_logins=0, locked_until=NULL WHERE id=$1`, [existing.id, hash]);
    console.log(`Senha do administrador "${login}" redefinida.`);
  } else {
    await query(
      `INSERT INTO users(username, name, password_hash, role, all_clients, must_change_password) VALUES ($1,$2,$3,'admin',TRUE,TRUE)`,
      [login, name, hash],
    );
    console.log(`Administrador "${login}" criado.`);
  }
  if (generated) console.log(`Senha temporária: ${password}\n(troca obrigatória no primeiro acesso)`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
