import { readFileSync } from 'node:fs';

function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
    return def;
  }
  return v;
}

function int(name: string, def: number): number {
  const n = Number(env(name, String(def)));
  if (!Number.isFinite(n)) throw new Error(`Variável ${name} deve ser numérica`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  return ['1', 'true', 'yes', 'sim'].includes(env(name, String(def)).toLowerCase());
}

/** Lê a chave mestra de MASTER_KEY_FILE (preferido, ex.: Docker secret) ou MASTER_KEY. */
function loadMasterKey(): Buffer {
  const file = process.env.MASTER_KEY_FILE;
  const raw = file ? readFileSync(file, 'utf8').trim() : env('MASTER_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY deve ter 32 bytes codificados em base64 (gere com: npm run gen-key)');
  }
  return key;
}

export const config = {
  host: env('HOST', '0.0.0.0'),
  port: int('PORT', 3000),
  databaseUrl: env('DATABASE_URL', 'postgres://mikrotik:mikrotik@localhost:5432/mikrotik'),
  dbPoolMax: int('DB_POOL_MAX', 15),
  get masterKey() {
    return loadMasterKey();
  },
  cookieSecure: bool('COOKIE_SECURE', true),
  trustProxy: bool('TRUST_PROXY', true),
  sessionTtlHours: int('SESSION_TTL_HOURS', 12),
  loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 5),
  loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
  ros: {
    connectTimeoutMs: int('ROS_CONNECT_TIMEOUT_MS', 5000),
    commandTimeoutMs: int('ROS_COMMAND_TIMEOUT_MS', 15000),
    maxConcurrent: int('ROS_MAX_CONCURRENT', 10),
    perDeviceConcurrent: int('ROS_PER_DEVICE_CONCURRENT', 2),
  },
  pollIntervalSec: int('POLL_INTERVAL_SEC', 60),
  wgPollIntervalSec: int('WG_POLL_INTERVAL_SEC', 60),
  cacheTtlSec: int('CACHE_TTL_SEC', 60),
  /** Handshake mais antigo que isso = peer "sem handshake recente". */
  wgHandshakeStaleSec: int('WG_HANDSHAKE_STALE_SEC', 180),
  collectorEnabled: bool('COLLECTOR_ENABLED', true),
  /** Fuso usado nas mensagens de notificação. */
  displayTimeZone: env('DISPLAY_TZ', 'America/Sao_Paulo'),
  logLevel: env('LOG_LEVEL', 'info'),
};
