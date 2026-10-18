/**
 * Integração UniFi contra controladoras de teste (UniFi OS e antiga) + PGlite.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeUnifi } from './fake-unifi.js';

const DB_PORT = 54327;
const H = { 'x-requested-with': 'slot1' };
let app: FastifyInstance;
let pgServer: PGLiteSocketServer;
let os: FakeUnifi;
let legacy: FakeUnifi;
let q: typeof import('../src/db/pool.js');
let cookie = '';
const ids: Record<string, number> = {};

async function call(method: string, url: string, body?: unknown, c = cookie) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...H, cookie: c } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: H });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  return String(Array.isArray(set) ? set[0] : set).split(';')[0];
}

beforeAll(async () => {
  const db = await PGlite.create();
  pgServer = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
  await pgServer.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`;
  const { migrate } = await import('../src/db/migrate.js');
  const { buildApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/lib/crypto.js');
  q = await import('../src/db/pool.js');
  await migrate(() => {});
  const hash = await hashPassword('Admin12345x');
  await q.query(`INSERT INTO users(username, name, password_hash, role, all_clients) VALUES ('admin','Admin',$1,'admin',TRUE), ('esc','Escritório',$1,'escritorio',TRUE)`, [hash]);
  app = await buildApp({ logger: false });
  os = new FakeUnifi('unifios');
  legacy = new FakeUnifi('legacy');
  await Promise.all([os.start(), legacy.start()]);
  cookie = await login('admin', 'Admin12345x');
  ids.client = (await call('POST', '/api/clients', { name: 'Condomínio Teste' })).body.id;
  ids.other = (await call('POST', '/api/clients', { name: 'Outro Cliente' })).body.id;
});

afterAll(async () => {
  await app?.close();
  await q?.pool.end();
  await Promise.all([os?.stop(), legacy?.stop()]);
  await pgServer?.stop();
});

describe('cadastro e teste de conexão', () => {
  it('detecta UniFi OS e controlador antigo, e recusa senha errada', async () => {
    const a = await call('POST', '/api/unifi/test', { url: os.url, username: os.username, password: os.password });
    expect(a.body).toMatchObject({ ok: true, platform: 'unifios', version: '8.6.9', sites: [{ name: 'default', desc: 'Condomínio Teste' }] });
    const b = await call('POST', '/api/unifi/test', { url: legacy.url, username: legacy.username, password: legacy.password });
    expect(b.body).toMatchObject({ ok: true, platform: 'legacy' });
    const c = await call('POST', '/api/unifi/test', { url: os.url, username: os.username, password: 'errada' });
    expect(c.body).toMatchObject({ ok: false, kind: 'auth', status: 'auth_failed' });
  });

  it('cadastra com senha cifrada e lê os dados sem expor chaves de Wi-Fi', async () => {
    const r = await call('POST', '/api/unifi/controllers', { name: 'Cloud Key Teste', client_id: ids.client, url: os.url, username: os.username, password: os.password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    ids.ctrl = r.body.id;
    expect(r.body).not.toHaveProperty('password_enc');
    const raw = await q.one('SELECT password_enc FROM unifi_controllers WHERE id = $1', [ids.ctrl]);
    expect(raw.password_enc).toMatch(/^v1:/);
    expect((await call('POST', '/api/unifi/controllers', { name: 'Dup', client_id: ids.client, url: os.url, username: 'x', password: 'y' })).status).toBe(409);

    const ref = await call('POST', `/api/unifi/controllers/${ids.ctrl}/refresh`);
    expect(ref.body.ok).toBe(true);
    expect(ref.body.controller.summary).toMatchObject({ sites: 1, devices: 2, aps: 2, online: 1, offline: 1, clients: 2, upgradable: 1 });
    expect(ref.body.controller).toMatchObject({ status: 'online', platform: 'unifios', version: '8.6.9' });

    const devs = await call('GET', `/api/unifi/controllers/${ids.ctrl}/sites/default/devices`);
    expect(devs.body.rows[0]).toMatchObject({ name: 'AP Hall', model_name: 'UAP-AC-Pro', state: 'online', upgradable: true, upgrade_to: '6.6.77' });
    expect(devs.body.rows[0].radios[0]).toMatchObject({ band: '2,4 GHz', channel: 6, tx_power: 20 });
    expect(devs.body.rows[1].state).toBe('offline');
    const cls = await call('GET', `/api/unifi/controllers/${ids.ctrl}/sites/default/clients`);
    expect(cls.body.rows[0]).toMatchObject({ name: 'celular-joao', ap_name: 'AP Hall', essid: 'Condominio', signal: -55, band: '5 GHz' });
    const wl = await call('GET', `/api/unifi/controllers/${ids.ctrl}/sites/default/wlans`);
    expect(wl.body.rows[0]).toMatchObject({ name: 'Condominio', enabled: true, clients: 2 });
    const all = JSON.stringify([devs.body, cls.body, wl.body]);
    expect(all).not.toMatch(/SENHA-WIFI|OUTRA-SENHA|SEGREDO-AP/);
    const cache = JSON.stringify(await q.query('SELECT data FROM unifi_cache'));
    expect(cache).not.toMatch(/SENHA-WIFI|OUTRA-SENHA|SEGREDO-AP/);
  });
});

describe('ações (com auditoria)', () => {
  const base = () => `/api/unifi/controllers/${ids.ctrl}/sites/default`;

  it('localizar, reiniciar (exige confirmação) e atualizar firmware', async () => {
    expect((await call('POST', `${base()}/devices/aa:bb:cc:00:00:01/action`, { action: 'locate', name: 'AP Hall' })).status).toBe(200);
    expect(os.data.default.devices[0].locating).toBe(true);
    expect((await call('POST', `${base()}/devices/aa:bb:cc:00:00:01/action`, { action: 'restart' })).status).toBe(400);
    expect((await call('POST', `${base()}/devices/aa:bb:cc:00:00:01/action`, { action: 'restart', confirm: true, name: 'AP Hall' })).status).toBe(200);
    expect(os.commands.at(-1)).toMatchObject({ path: 'cmd/devmgr', body: { cmd: 'restart', mac: 'aa:bb:cc:00:00:01' } });
    expect((await call('POST', `${base()}/devices/aa:bb:cc:00:00:01/action`, { action: 'upgrade', confirm: true })).status).toBe(200);
    const bad = await call('POST', `${base()}/devices/aa:bb:cc:00:00:99/action`, { action: 'locate' });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toMatch(/Dispositivo não encontrado/);
  });

  it('reconectar, bloquear e desbloquear cliente; desativar rede Wi-Fi', async () => {
    expect((await call('POST', `${base()}/clients/11:22:33:44:55:01/action`, { action: 'kick' })).status).toBe(200);
    expect((await call('POST', `${base()}/clients/11:22:33:44:55:01/action`, { action: 'block' })).status).toBe(400);
    expect((await call('POST', `${base()}/clients/11:22:33:44:55:01/action`, { action: 'block', confirm: true, name: 'celular-joao' })).status).toBe(200);
    expect(os.data.default.users.some((u) => u.mac === '11:22:33:44:55:01')).toBe(true);
    expect((await call('POST', `${base()}/clients/11:22:33:44:55:01/action`, { action: 'unblock' })).status).toBe(200);
    expect((await call('PUT', `${base()}/wlans/5f0000000000000000000002`, { enabled: false, name: 'Visitantes' })).status).toBe(200);
    expect(os.data.default.wlans[1].enabled).toBe(false);
  });

  it('renova a sessão quando expira, sem novo erro', async () => {
    const before = os.logins;
    os.expireSessions();
    expect((await call('POST', `/api/unifi/controllers/${ids.ctrl}/refresh`)).body.ok).toBe(true);
    expect(os.logins).toBe(before + 1);
  });

  it('auditoria por controladora', async () => {
    const r = await call('GET', `/api/audit?controller_id=${ids.ctrl}`);
    const actions = r.body.rows.map((x: any) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['unifi.controller.create', 'unifi.device.locate', 'unifi.device.restart', 'unifi.device.upgrade', 'unifi.client.block', 'unifi.wlan.disable']));
    expect(r.body.rows.find((x: any) => x.action === 'unifi.device.locate' && x.success === false)).toBeTruthy();
    const overview = await call('GET', '/api/audit/devices');
    expect(overview.body.controllers[0]).toMatchObject({ controller_id: ids.ctrl, client_name: 'Condomínio Teste' });
    expect(overview.body.controllers[0].total).toBeGreaterThanOrEqual(8);
    const sys = await call('GET', '/api/audit?scope=system');
    expect(sys.body.rows.some((x: any) => x.action.startsWith('unifi.'))).toBe(false);
  });
});

describe('acesso por API key (Integration API oficial)', () => {
  it('testa, detecta versão e recusa chave errada', async () => {
    const ok = await call('POST', '/api/unifi/test', { url: os.url, auth_type: 'apikey', password: os.apiKey });
    expect(ok.body).toMatchObject({ ok: true, auth_type: 'apikey', platform: 'unifios', version: '10.1.84', sites: [{ desc: 'Condomínio Teste' }] });
    expect(ok.body.capabilities).toMatchObject({ restart: true, locate: false, block: false, wlanToggle: true });
    const bad = await call('POST', '/api/unifi/test', { url: os.url, auth_type: 'apikey', password: 'errada' });
    expect(bad.body).toMatchObject({ ok: false, kind: 'auth' });
  });

  it('lê dispositivos, clientes e redes; reinicia antena e alterna rede Wi-Fi', async () => {
    const url = os.url.replace('127.0.0.1', 'localhost');
    const c = await call('POST', '/api/unifi/controllers', { name: 'Cloud Key API', client_id: ids.client, url, auth_type: 'apikey', password: os.apiKey });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    ids.api = c.body.id;
    expect(c.body).toMatchObject({ auth_type: 'apikey', username: null });
    const raw = await q.one('SELECT password_enc FROM unifi_controllers WHERE id = $1', [ids.api]);
    expect(raw.password_enc).not.toContain(os.apiKey);
    const ref = await call('POST', `/api/unifi/controllers/${ids.api}/refresh`);
    expect(ref.body.ok, JSON.stringify(ref.body)).toBe(true);
    expect(ref.body.controller.summary).toMatchObject({ devices: 2, online: 1, offline: 1, clients: 2 });
    const info = await call('GET', `/api/unifi/controllers/${ids.api}`);
    const site = info.body.sites[0].name;
    expect(site).toBe('b1c2d3e4-0000-4000-8000-000000000001');
    const devs = await call('GET', `/api/unifi/controllers/${ids.api}/sites/${site}/devices`);
    expect(devs.body.rows[0]).toMatchObject({ name: 'AP Hall', mac: 'aa:bb:cc:00:00:01', state: 'online', version: '6.6.55', upgradable: true, clients: 2, cpu: 12 });
    expect(devs.body.rows[0].radios[0]).toMatchObject({ band: '2,4 GHz', channel: 6, width: 20 });
    const cls = await call('GET', `/api/unifi/controllers/${ids.api}/sites/${site}/clients`);
    expect(cls.body.rows[0]).toMatchObject({ name: 'celular-joao', ap_name: 'AP Hall', mac: '11:22:33:44:55:01' });
    const wl = await call('GET', `/api/unifi/controllers/${ids.api}/sites/${site}/wlans`);
    expect(wl.body.rows.map((w: any) => w.name)).toEqual(['Condominio', 'Visitantes']);
    expect(JSON.stringify([devs.body, cls.body, wl.body])).not.toMatch(/SENHA-WIFI|OUTRA-SENHA/);

    const base = `/api/unifi/controllers/${ids.api}/sites/${site}`;
    expect((await call('POST', `${base}/devices/aa:bb:cc:00:00:01/action`, { action: 'restart', confirm: true, name: 'AP Hall' })).status).toBe(200);
    expect(os.commands.at(-1)).toMatchObject({ path: 'devices/d1/actions', body: { action: 'RESTART' } });
    const loc = await call('POST', `${base}/devices/aa:bb:cc:00:00:01/action`, { action: 'locate' });
    expect(loc.status).toBe(400);
    expect(loc.body.message).toMatch(/não está disponível no acesso por API key/);
    expect((await call('POST', `${base}/clients/11:22:33:44:55:01/action`, { action: 'kick' })).status).toBe(400);
    os.data.default.wlans[0].enabled = true;
    expect((await call('PUT', `${base}/wlans/${wl.body.rows[0].id}`, { enabled: false, name: 'Condominio' })).status).toBe(200);
    expect(os.data.default.wlans[0].enabled).toBe(false);
    expect(os.data.default.wlans[0].x_passphrase).toBe('SENHA-WIFI-SECRETA');

    // Trocar para usuário/senha muda o identificador do site (uuid → "default"): o resumo não pode somar os dois.
    const sw = await call('PUT', `/api/unifi/controllers/${ids.api}`, { name: 'Cloud Key API', client_id: ids.client, url, auth_type: 'password', username: os.username, password: os.password });
    expect(sw.status, JSON.stringify(sw.body)).toBe(200);
    const ref2 = await call('POST', `/api/unifi/controllers/${ids.api}/refresh`);
    expect(ref2.body.controller.summary).toMatchObject({ devices: 2, online: 1, offline: 1 });
    const left = await q.query('SELECT DISTINCT site FROM unifi_cache WHERE controller_id = $1', [ids.api]);
    expect(left.map((r: any) => r.site).sort()).toEqual(['', 'default']);
  });

  it('Network 9.x: sem redes Wi-Fi pela API key, o resto funciona', async () => {
    os.intVersion = '9.1.120';
    const t = await call('POST', '/api/unifi/test', { url: os.url, auth_type: 'apikey', password: os.apiKey });
    expect(t.body.capabilities).toMatchObject({ wlans: false, wlanToggle: false, restart: true });
    os.intVersion = '10.1.84';
  });
});

describe('permissões, escopo e falhas', () => {
  it('escritório não vê UniFi sem permissão; técnico só vê o próprio cliente', async () => {
    const esc = await login('esc', 'Admin12345x');
    expect((await call('GET', '/api/unifi/controllers', undefined, esc)).status).toBe(403);
    const t = await call('POST', '/api/users', { username: 'tec', name: 'Técnico', role: 'tecnico', password: 'Tecnico12345', must_change_password: false, client_ids: [ids.other] });
    expect(t.status).toBe(200);
    const tec = await login('tec', 'Tecnico12345');
    expect((await call('GET', '/api/unifi/controllers', undefined, tec)).body).toEqual([]);
    expect((await call('GET', `/api/unifi/controllers/${ids.ctrl}`, undefined, tec)).status).toBe(403);
    expect((await call('POST', '/api/unifi/controllers', { name: 'X', client_id: ids.other, url: legacy.url, username: 'a', password: 'b' }, tec)).status).toBe(403);
  });

  it('controladora fora do ar: status inacessível e última leitura preservada', async () => {
    await os.stop();
    const r = await call('POST', `/api/unifi/controllers/${ids.ctrl}/refresh`);
    expect(r.body.ok).toBe(false);
    expect(r.body.controller.status).toBe('unreachable');
    const devs = await call('GET', `/api/unifi/controllers/${ids.ctrl}/sites/default/devices`);
    expect(devs.body.rows).toHaveLength(2);
    expect(devs.body.stale).toBe(true);
    const dash = await call('GET', '/api/dashboard');
    expect(dash.body.unifi).toMatchObject({ controllers: 2, problems: 1 });
  });
});
