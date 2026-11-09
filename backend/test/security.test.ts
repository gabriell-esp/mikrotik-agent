/**
 * Regras de segurança: anti-escalonamento de quem gerencia usuários, escopo de clientes,
 * credenciais salvas que não podem ser desviadas para outro destino e central WireGuard restrita.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_PORT = 54325;
const H = { 'x-requested-with': 'easyso' };
let app: FastifyInstance;
let pgServer: PGLiteSocketServer;
let q: typeof import('../src/db/pool.js');
const s: Record<string, string> = {};
const ids: Record<string, number> = {};

async function call(method: string, url: string, body?: unknown, who = 'admin') {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...H, cookie: s[who] } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: H });
  expect(res.statusCode, res.body).toBe(200);
  const set = res.headers['set-cookie'];
  return String(Array.isArray(set) ? set[0] : set).split(';')[0];
}
async function newUser(username: string, role: string, extra: Record<string, unknown> = {}, who = 'admin') {
  const r = await call('POST', '/api/users', { username, name: username.toUpperCase(), role, password: 'Senha12345x', must_change_password: false, ...extra }, who);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  s[username] = await login(username, 'Senha12345x');
  return r.body.id as number;
}
const device = (over: Record<string, unknown>) => ({ api_method: 'api-ssl', username: 'api', password: 'segredo-do-roteador', poll_enabled: false, ...over });

beforeAll(async () => {
  const db = await PGlite.create();
  pgServer = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
  await pgServer.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`;
  process.env.COLLECTOR_ENABLED = 'false';
  const { migrate } = await import('../src/db/migrate.js');
  const { buildApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/lib/crypto.js');
  q = await import('../src/db/pool.js');
  await migrate(() => {});
  await q.query(`INSERT INTO users(username, name, password_hash, role, all_clients) VALUES ('admin','Admin',$1,'admin',TRUE)`, [await hashPassword('Admin12345x')]);
  app = await buildApp({ logger: false });
  s.admin = await login('admin', 'Admin12345x');
  ids.a = (await call('POST', '/api/clients', { name: 'Condomínio A' })).body.id;
  ids.b = (await call('POST', '/api/clients', { name: 'Condomínio B' })).body.id;
  // Gestor de usuários sem ser administrador: escritório + users.manage + clients.manage, só no cliente A.
  ids.gestor = await newUser('gestor', 'escritorio', { client_ids: [ids.a], permissions_grant: ['users.manage', 'clients.manage', 'devices.manage'] });
});

afterAll(async () => {
  await app?.close();
  await q?.pool.end();
  await pgServer?.stop();
});

describe('gestão de usuários sem ser administrador', () => {
  it('não cria administrador nem concede o que não tem', async () => {
    const base = { name: 'Xis', password: 'Senha12345x', must_change_password: false, client_ids: [ids.a] };
    expect((await call('POST', '/api/users', { ...base, username: 'novo.admin', role: 'admin' }, 'gestor')).status).toBe(403);
    expect((await call('POST', '/api/users', { ...base, username: 'novo.esc', role: 'escritorio', permissions_grant: ['pppoe.password'] }, 'gestor')).status).toBe(403);
    expect((await call('POST', '/api/users', { ...base, username: 'novo.tec', role: 'tecnico' }, 'gestor')).status).toBe(403); // técnico tem permissões que o gestor não tem
    expect((await call('POST', '/api/users', { ...base, username: 'novo.todos', role: 'escritorio', all_clients: true }, 'gestor')).status).toBe(403);
    expect((await call('POST', '/api/users', { ...base, username: 'novo.b', role: 'escritorio', client_ids: [ids.b] }, 'gestor')).status).toBe(403);
    const ok = await call('POST', '/api/users', { ...base, username: 'novo.ok', role: 'escritorio' }, 'gestor');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    ids.novo = ok.body.id;
  });

  it('não altera, não redefine senha nem desbloqueia administrador ou quem tem mais permissões', async () => {
    const adminId = (await q.one(`SELECT id FROM users WHERE username = 'admin'`)).id;
    expect((await call('POST', `/api/users/${adminId}/reset-password`, { password: 'Tomada12345x' }, 'gestor')).status).toBe(403);
    expect((await call('PUT', `/api/users/${adminId}`, { name: 'Admin', role: 'admin', active: false }, 'gestor')).status).toBe(403);
    expect((await call('POST', `/api/users/${adminId}/unlock`, undefined, 'gestor')).status).toBe(403);
    const tec = await newUser('tec.forte', 'tecnico', { client_ids: [ids.a] });
    expect((await call('POST', `/api/users/${tec}/reset-password`, { password: 'Tomada12345x' }, 'gestor')).status).toBe(403);
    // O próprio gestor não se dá permissões nem clientes por aqui.
    expect((await call('PUT', `/api/users/${ids.gestor}`, { name: 'Gestor', role: 'escritorio', all_clients: true }, 'gestor')).status).toBe(403);
    // Quem está dentro do seu alcance continua gerenciável.
    expect((await call('POST', `/api/users/${ids.novo}/reset-password`, { password: 'Nova12345xy' }, 'gestor')).status).toBe(200);
    expect((await call('PUT', `/api/users/${ids.novo}`, { name: 'Novo', role: 'escritorio', client_ids: [ids.a], permissions_grant: ['pppoe.password'] }, 'gestor')).status).toBe(403);
  });

  it('grupos de permissões são só para administradores', async () => {
    expect((await call('GET', '/api/permission-groups', undefined, 'gestor')).status).toBe(403);
    expect((await call('POST', '/api/permission-groups', { name: 'Tudo', permissions: ['users.manage'], member_ids: [ids.gestor] }, 'gestor')).status).toBe(403);
    const g = await call('POST', '/api/permission-groups', { name: 'Senhas', permissions: ['pppoe.view', 'pppoe.password'] });
    expect((await call('PUT', `/api/users/${ids.novo}`, { name: 'Novo', role: 'escritorio', client_ids: [ids.a], group_ids: [g.body.id] }, 'gestor')).status).toBe(403);
  });
});

describe('escopo de clientes', () => {
  it('não edita nem exclui cliente fora do escopo', async () => {
    expect((await call('PUT', `/api/clients/${ids.b}`, { name: 'Tomado' }, 'gestor')).status).toBe(403);
    expect((await call('DELETE', `/api/clients/${ids.b}`, {}, 'gestor')).status).toBe(403);
    expect((await call('PUT', `/api/clients/${ids.a}`, { name: 'Condomínio A' }, 'gestor')).status).toBe(200);
  });

  it('só quem acessa todos os clientes cadastra a central', async () => {
    expect((await call('POST', '/api/devices', device({ name: 'Central falsa', is_central: true, host: '10.9.9.9' }), 'gestor')).status).toBe(403);
  });
});

describe('credenciais salvas não podem ser desviadas', () => {
  it('equipamento: trocar o destino exige a senha de novo (teste e edição)', async () => {
    const d = await call('POST', '/api/devices', device({ name: 'MK A', client_id: ids.a, host: '10.0.0.10' }), 'gestor');
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const body = { name: 'MK A', client_id: ids.a, host: '203.0.113.66', api_method: 'api-ssl', username: 'api', poll_enabled: false };
    const t = await call('POST', '/api/devices/test', { host: '203.0.113.66', api_method: 'api-ssl', username: 'api', device_id: d.body.id }, 'gestor');
    expect(t.status).toBe(400);
    expect(t.body.message).toMatch(/senha/);
    expect((await call('PUT', `/api/devices/${d.body.id}`, body, 'gestor')).status).toBe(400);
    expect((await call('PUT', `/api/devices/${d.body.id}`, { ...body, host: '10.0.0.10', username: 'outro' }, 'gestor')).status).toBe(400);
    expect((await call('PUT', `/api/devices/${d.body.id}`, { ...body, host: '10.0.0.10', name: 'MK A renomeada' }, 'gestor')).status).toBe(200);
    expect((await call('PUT', `/api/devices/${d.body.id}`, { ...body, password: 'nova-senha' }, 'gestor')).status).toBe(200);
  });

  it('UniFi: trocar o endereço exige a senha/API key de novo', async () => {
    const c = await call('POST', '/api/unifi/controllers', { name: 'CK', client_id: ids.a, url: 'https://10.0.0.20', username: 'u', password: 'p', poll_enabled: false });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const t = await call('POST', '/api/unifi/test', { url: 'https://203.0.113.66', username: 'u', controller_id: c.body.id });
    expect(t.status).toBe(400);
    const put = await call('PUT', `/api/unifi/controllers/${c.body.id}`, { name: 'CK', client_id: ids.a, url: 'https://203.0.113.66', username: 'u', poll_enabled: false });
    expect(put.status).toBe(400);
    expect((await call('PUT', `/api/unifi/controllers/${c.body.id}`, { name: 'CK 2', client_id: ids.a, url: 'https://10.0.0.20', username: 'u', poll_enabled: false })).status).toBe(200);
  });

  it('WhatsApp: trocar a URL exige a chave de novo', async () => {
    const base = { enabled: false, session: 'easyso', delay_sec: 60, resource_threshold: 90 };
    expect((await call('PUT', '/api/notifications/settings', { ...base, base_url: 'http://wppconnect:21465', secret_key: 'chave' })).status).toBe(200);
    expect((await call('PUT', '/api/notifications/settings', { ...base, base_url: 'http://203.0.113.66:21465' })).status).toBe(400);
    expect((await call('PUT', '/api/notifications/settings', { ...base, base_url: 'http://wppconnect:21465', delay_sec: 30 })).status).toBe(200);
  });
});

describe('central WireGuard', () => {
  it('quem não acessa todos os clientes vê só os próprios peers e não consulta nem vincula a central', async () => {
    const central = await q.one(`INSERT INTO devices(name, is_central, host, username, password_enc, poll_enabled) VALUES ('Central', TRUE, '10.255.0.1', 'api', 'x', FALSE) RETURNING id`);
    const mine = await q.one(`SELECT id FROM devices WHERE client_id = $1 LIMIT 1`, [ids.a]);
    await q.query(`INSERT INTO wg_peers(central_device_id, public_key, name, allowed_address, device_id) VALUES ($1,'k1','Peer A','10.200.0.2/32',$2), ($1,'k2','Peer B','10.200.0.3/32',NULL)`, [central.id, mine.id]);
    const tec = await newUser('tec.a', 'tecnico', { client_ids: [ids.a] });
    expect(tec).toBeGreaterThan(0);
    const r = await call('GET', '/api/wireguard/peers', undefined, 'tec.a');
    expect(r.status).toBe(200);
    expect(r.body.peers.map((p: any) => p.name)).toEqual(['Peer A']);
    expect(r.body.central.host).toBeNull();
    expect((await call('POST', '/api/wireguard/sync', {}, 'tec.a')).status).toBe(403);
    const peerB = await q.one(`SELECT id FROM wg_peers WHERE public_key = 'k2'`);
    expect((await call('PUT', `/api/wireguard/peers/${peerB.id}/link`, { device_id: mine.id }, 'tec.a')).status).toBe(403);
    expect((await call('GET', '/api/wireguard/peers')).body.peers).toHaveLength(2);
  });
});
