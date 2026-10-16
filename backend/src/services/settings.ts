import { one, query } from '../db/pool.js';

export async function getSetting<T>(key: string, def: T): Promise<T> {
  const r = await one<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  return r ? { ...def, ...r.value } : def;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await query(
    `INSERT INTO settings(key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
