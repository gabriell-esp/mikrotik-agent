/**
 * Fluxos principais contra PostgreSQL embutido (PGlite) e um servidor de TESTE que fala o protocolo
 * da API RouterOS. Valida login, permissões, escopo por cliente, WireGuard, módulos, PPPoE e auditoria.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeRouterOS, sampleRouter } from './fake-routeros.js';

const DB_PORT = 54329;
let app: FastifyInstance;
let pgServer: PGLiteSocketServer;
let central: FakeRouterOS;
let routerA: FakeRouterOS;
let routerB: FakeRouterOS;
let q: typeof import('../src/db/pool.js');

const H = { 'x-requested-with': 'slot1' };
let adminCookie = '';

async function call(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...H, cookie } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: H });
  expect(res.statusCode, res.body).toBe(200);
  const set = res.headers['set-cookie'];
  return String(Array.isArray(set) ? set[0] : set).split(';')[0];
}

const devicePayload = (over: Record<string, unknown>) => ({
  api_method: 'api', allow_plaintext: true, username: 'api', password: 'secret', poll_enabled: false, ...over,
});

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
  await q.query(`INSERT INTO users(username, name, password_hash, role, all_clients) VALUES ('admin','Admin',$1,'admin',TRUE)`, [await hashPassword('Admin12345x')]);
  app = await buildApp({ logger: false });

  central = new FakeRouterOS({ data: sampleRouter() });
  routerA = new FakeRouterOS({ data: sampleRouter() });
  routerB = new FakeRouterOS({ data: sampleRouter(), loginMode: 'challenge' });
  await Promise.all([central.start(), routerA.start(), routerB.start()]);
  adminCookie = await login('admin', 'Admin12345x');
});

afterAll(async () => {
  await app?.close();
  await q?.pool.end();
  await Promise.all([central?.stop(), routerA?.stop(), routerB?.stop()]);
  await pgServer?.stop();
});

const ids: Record<string, number> = {};

describe('autenticação', () => {
  it('rejeita senha errada e requisição sem cabeçalho CSRF', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'x' }, headers: H });
    expect(bad.statusCode).toBe(401);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/clients', payload: { name: 'X' }, headers: { cookie: adminCookie } });
    expect(noCsrf.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/devices' });
    expect(anon.statusCode).toBe(401);
  });

  it('retorna o usuário logado com permissões', async () => {
    const r = await call('GET', '/api/auth/me');
    expect(r.body.user.role).toBe('admin');
    expect(r.body.user.permissions).toContain('pppoe.password');
  });
});

describe('cadastro e WireGuard', () => {
  it('cria clientes e equipamentos (credencial cifrada no banco)', async () => {
    ids.clientA = (await call('POST', '/api/clients', { name: 'Cliente A' })).body.id;
    ids.clientB = (await call('POST', '/api/clients', { name: 'Cliente B' })).body.id;
    expect((await call('POST', '/api/clients', { name: 'cliente a' })).status).toBe(409);

    const test = await call('POST', '/api/devices/test', devicePayload({ host: '127.0.0.1', api_port: central.port }));
    expect(test.body).toMatchObject({ ok: true, method: 'api', version: '7.16.1 (stable)', identity: 'CLIENTE-A-RB' });

    const c = await call('POST', '/api/devices', devicePayload({ name: 'Central Slot1', is_central: true, host: '127.0.0.1', api_port: central.port }));
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    ids.central = c.body.id;
    const a = await call('POST', '/api/devices', devicePayload({ name: 'RB Cliente A', client_id: ids.clientA, host: '127.0.0.1', api_port: routerA.port }));
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    ids.devA = a.body.id;
    const b = await call('POST', '/api/devices', devicePayload({ name: 'RB Cliente B', client_id: ids.clientB, host: '127.0.0.1', api_port: routerB.port }));
    ids.devB = b.body.id;
    expect(b.body).not.toHaveProperty('password_enc');

    const raw = await q.one('SELECT password_enc FROM devices WHERE id = $1', [ids.devA]);
    expect(raw.password_enc).toMatch(/^v1:/);
    expect(raw.password_enc).not.toContain('secret');
    expect((await call('POST', '/api/devices', devicePayload({ name: 'Sem cliente', host: '10.9.9.9', api_port: 1 }))).status).toBe(400);
  });

  it('sincroniza peers da central sem expor chaves privadas/PSK', async () => {
    const s = await call('POST', '/api/wireguard/sync');
    expect(s.body).toEqual({ ok: true, count: 2 });
    const r = await call('GET', '/api/wireguard/peers');
    expect(r.body.peers).toHaveLength(2);
    const p1 = r.body.peers.find((p: any) => p.public_key === 'PEER1KEY=');
    const p2 = r.body.peers.find((p: any) => p.public_key === 'PEER2KEY=');
    expect(p1).toMatchObject({ state: 'recent', last_handshake_seconds: 70, rx_bytes: 123456, suggested_host: '10.200.0.2', current_endpoint_address: '177.10.10.10' });
    expect(p2.state).toBe('never');
    expect(JSON.stringify(r.body)).not.toMatch(/PRIVADA|PSK-NAO/);
    // nada foi alterado na central: apenas comandos de leitura
    expect(central.commands.every((c) => c === '/login' || c.endsWith('/print'))).toBe(true);
    ids.peer1 = p1.id;
  });

  it('vincula peer ao equipamento e reflete no dashboard', async () => {
    expect((await call('PUT', `/api/wireguard/peers/${ids.peer1}/link`, { device_id: ids.devA })).status).toBe(200);
    const d = await call('GET', `/api/devices/${ids.devA}`);
    expect(d.body.peer_state).toBe('recent');
    const dash = await call('GET', '/api/dashboard');
    expect(dash.body.wireguard.summary).toMatchObject({ total: 2, recent: 1, never: 1, unlinked: 1 });
    expect(dash.body.counts.total).toBe(3);
  });
});

describe('monitoramento', () => {
  it('módulo sistema grava versão/modelo e informa seções indisponíveis', async () => {
    const r = await call('GET', `/api/devices/${ids.devA}/modules/system?refresh=1`);
    expect(r.status).toBe(200);
    expect(r.body.stale).toBe(false);
    expect(r.body.collectedAt).toBeTruthy();
    const res = r.body.sections.find((s: any) => s.key === 'resource');
    expect(res.rows[0]['cpu-load']).toBe('7');
    const dev = await call('GET', `/api/devices/${ids.devA}`);
    expect(dev.body).toMatchObject({ status: 'online', ros_version: '7.16.1 (stable)', board_name: 'RBD52G-5HacD2HnD', identity: 'CLIENTE-A-RB' });
    const vpn = await call('GET', `/api/devices/${ids.devA}/modules/vpn?refresh=1`);
    const l2tp = vpn.body.sections.find((s: any) => s.key === 'l2tp');
    expect(l2tp.ok).toBe(false);
    expect(l2tp.reason).toMatch(/Menu inexistente/);
    expect(JSON.stringify(vpn.body)).not.toMatch(/PRIVADA/);
  });

  it('logs com filtros', async () => {
    const r = await call('GET', `/api/devices/${ids.devA}/logs?topic=critical`);
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].message).toMatch(/login failure/);
    const p = await call('GET', `/api/devices/${ids.devA}/logs?from=2026-10-14T09:59:10`);
    expect(p.body.rows).toHaveLength(1);
  });

  it('tráfego instantâneo', async () => {
    const r = await call('GET', `/api/devices/${ids.devA}/traffic?interfaces=ether1`);
    expect(r.body.rows[0]).toMatchObject({ name: 'ether1', rxBps: 1000, txBps: 2000 });
  });

  it('login por desafio MD5 (RouterOS anterior ao 6.43)', async () => {
    const r = await call('GET', `/api/devices/${ids.devB}/modules/system?refresh=1`);
    expect(r.body.stale).toBe(false);
    expect(r.body.deviceStatus).toBe('online');
  });
});

describe('PPPoE', () => {
  it('lista secrets em busca global, sem senha, com estado conectado', async () => {
    await call('POST', '/api/pppoe/refresh', {});
    const r = await call('GET', '/api/pppoe/secrets?search=joao');
    const joao = r.body.rows.find((x: any) => x.device_id === ids.devA);
    expect(joao).toMatchObject({ name: 'joao', profile: 'plano-50', connected: true, disabled: false, client_name: 'Cliente A' });
    expect(JSON.stringify(r.body)).not.toMatch(/SenhaJoao1/);
    const dis = await call('GET', `/api/pppoe/secrets?status=disabled&device_id=${ids.devA}`);
    expect(dis.body.rows.map((x: any) => x.name)).toEqual(['maria']);
    const act = await call('GET', `/api/pppoe/active?device_id=${ids.devA}`);
    expect(act.body.rows[0]).toMatchObject({ name: 'joao', address: '10.0.0.10' });
  });

  it('PPPoE é por MikroTik de cliente: resumo por equipamento e central excluída', async () => {
    const r = await call('GET', '/api/pppoe/devices');
    const ids_ = r.body.map((d: any) => d.device_id);
    expect(ids_).not.toContain(ids.central);
    const a = r.body.find((d: any) => d.device_id === ids.devA);
    expect(a).toMatchObject({ client_name: 'Cliente A', has_pppoe: true, secrets_total: 2, secrets_disabled: 1, online: 1, servers: ['ether2'] });
    const all = await call('GET', '/api/pppoe/secrets');
    expect(all.body.rows.some((x: any) => x.device_id === ids.central)).toBe(false);
    expect((await call('GET', `/api/devices/${ids.central}/modules/ppp`)).status).toBe(400);
    expect((await call('GET', `/api/devices/${ids.central}/pppoe/profiles`)).status).toBe(400);
    const dev = await call('GET', `/api/devices/${ids.central}`);
    expect(dev.body.modules.map((m: any) => m.key)).not.toContain('ppp');
  });

  it('cria secret com validação e bloqueio de duplicidade', async () => {
    const bad = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'novo user', password: 'x', profile: 'plano-50', remote_address: '10.0.0.300' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/usuário não pode conter espaços/);
    expect(bad.body.message).toMatch(/IPv4 inválido/);
    const noProfile = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'novo', password: 'Abc123', profile: 'inexistente' });
    expect(noProfile.status).toBe(400);
    const ok = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'novo', password: 'Abc123', profile: 'plano-50', remote_address: '10.0.0.20', comment: 'Instalação 14/10' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(routerA.data['/ppp/secret'].find((s) => s.name === 'novo')).toMatchObject({ password: 'Abc123', profile: 'plano-50', 'remote-address': '10.0.0.20' });
    const dup = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'novo', password: 'Abc123', profile: 'plano-50' });
    expect(dup.status).toBe(409);
  });

  it('edita secret (inclui limpar campo) e audita sem senha', async () => {
    const id = routerA.data['/ppp/secret'].find((s) => s.name === 'novo')!['.id'];
    const r = await call('PUT', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(id)}`, {
      expected_name: 'novo', name: 'novo', password: 'NovaSenha9', profile: 'plano-100', remote_address: '', comment: 'Plano alterado',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = routerA.data['/ppp/secret'].find((x) => x.name === 'novo')!;
    expect(s).toMatchObject({ profile: 'plano-100', password: 'NovaSenha9', comment: 'Plano alterado' });
    expect(s['remote-address']).toBeUndefined();
    const stale = await call('PUT', `/api/devices/${ids.devA}/pppoe/secrets/*FFFF`, { expected_name: 'novo', name: 'novo', profile: 'plano-100' });
    expect(stale.status).toBe(404);
  });

  it('desabilita com desconexão, exclui e desconecta com confirmação', async () => {
    const joaoId = routerA.data['/ppp/secret'].find((s) => s.name === 'joao')!['.id'];
    const t = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(joaoId)}/toggle`, { expected_name: 'joao', disabled: true, disconnect: true });
    expect(t.body).toEqual({ ok: true, disconnected: 1 });
    expect(routerA.data['/ppp/active']).toHaveLength(0);
    expect(routerA.data['/ppp/secret'].find((s) => s.name === 'joao')!.disabled).toBe('true');

    const novoId = routerA.data['/ppp/secret'].find((s) => s.name === 'novo')!['.id'];
    const wrong = await call('DELETE', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(novoId)}`, { expected_name: 'novo', confirm: 'nov' });
    expect(wrong.status).toBe(400);
    const del = await call('DELETE', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(novoId)}`, { expected_name: 'novo', confirm: 'novo' });
    expect(del.status).toBe(200);
    expect(routerA.data['/ppp/secret'].some((s) => s.name === 'novo')).toBe(false);

    routerA.data['/ppp/active'].push({ '.id': '*AA', name: 'maria', address: '10.0.0.30' });
    const disc = await call('DELETE', `/api/devices/${ids.devA}/pppoe/active/${encodeURIComponent('*AA')}`, { expected_name: 'maria', confirm: 'maria' });
    expect(disc.status).toBe(200);
    expect(routerA.data['/ppp/active']).toHaveLength(0);
  });

  it('visualização de senha exige permissão e é auditada', async () => {
    const mariaId = routerA.data['/ppp/secret'].find((s) => s.name === 'maria')!['.id'];
    const r = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(mariaId)}/password`, { expected_name: 'maria' });
    expect(r.body.password).toBe('SenhaMaria2');
    const log = await q.one(`SELECT * FROM audit_log WHERE action = 'pppoe.password.view' ORDER BY id DESC LIMIT 1`);
    expect(log).toMatchObject({ username: 'admin', device_id: ids.devA, target: 'maria', success: true });
  });

  it('auditoria registra quem/quando/onde e nunca contém senhas', async () => {
    const rows = await q.query('SELECT action, username, device_name, details FROM audit_log');
    const text = JSON.stringify(rows);
    for (const pw of ['SenhaJoao1', 'SenhaMaria2', 'Abc123', 'NovaSenha9', 'Admin12345x', '"secret"']) expect(text).not.toContain(pw);
    const actions = rows.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining([
      'auth.login', 'device.create', 'wireguard.link', 'pppoe.secret.create', 'pppoe.secret.update',
      'pppoe.secret.disable', 'pppoe.secret.delete', 'pppoe.session.disconnect', 'pppoe.password.view',
    ]));
    const upd = rows.find((r: any) => r.action === 'pppoe.secret.update');
    expect(upd.details).toMatchObject({ profile: { de: 'plano-50', para: 'plano-100' }, pw_changed: true });
  });
});

describe('auditoria por equipamento', () => {
  it('resume por equipamento e separa eventos do sistema e de equipamentos removidos', async () => {
    const r = await call('GET', '/api/audit/devices');
    const a = r.body.devices.find((d: any) => d.device_id === ids.devA);
    expect(a.total).toBeGreaterThanOrEqual(7);
    expect(a.sensitive).toBe(1);
    expect(a.failures).toBeGreaterThan(0); // tentativas recusadas (duplicidade, item desatualizado)
    expect(a.last).toHaveProperty('action');
    expect(r.body.system.total).toBeGreaterThan(0);

    const devLog = await call('GET', `/api/audit?device_id=${ids.devA}`);
    expect(devLog.body.rows.every((x: any) => x.device_id === ids.devA)).toBe(true);
    const sys = await call('GET', '/api/audit?scope=system');
    expect(sys.body.rows.every((x: any) => x.device_id === null && x.device_name === null)).toBe(true);
    expect(sys.body.rows.map((x: any) => x.action)).toContain('auth.login');
    const acts = await call('GET', `/api/audit/actions?device_id=${ids.devA}`);
    expect(acts.body).toContain('pppoe.secret.create');
    expect(acts.body).not.toContain('auth.login');

    const tmp = await call('POST', '/api/devices', devicePayload({ name: 'Temporário', client_id: ids.clientB, host: '10.250.0.9', api_port: 1 }));
    expect((await call('DELETE', `/api/devices/${tmp.body.id}`, { confirm: 'Temporário' })).status).toBe(200);
    const rem = await call('GET', '/api/audit?scope=removed');
    expect(rem.body.rows.map((x: any) => x.action)).toEqual(expect.arrayContaining(['device.create', 'device.delete']));
    expect(rem.body.rows.every((x: any) => x.device_name === 'Temporário')).toBe(true);
    expect((await call('GET', '/api/audit/devices')).body.removed.devices).toBe(1);
  });
});

describe('permissões do perfil escritório', () => {
  let officeCookie = '';
  let officeId = 0;

  it('admin cria usuário escritório restrito ao Cliente A', async () => {
    const r = await call('POST', '/api/users', {
      username: 'atendimento', name: 'Atendimento', role: 'escritorio', password: 'Escritorio123', must_change_password: false, client_ids: [ids.clientA],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    officeId = r.body.id;
    expect(r.body.effective_permissions).not.toContain('pppoe.create');
    officeCookie = await login('atendimento', 'Escritorio123');
  });

  it('vê só equipamentos do próprio cliente e não acessa a central', async () => {
    const r = await call('GET', '/api/devices', undefined, officeCookie);
    expect(r.body.map((d: any) => d.id)).toEqual([ids.devA]);
    expect((await call('GET', `/api/devices/${ids.devB}`, undefined, officeCookie)).status).toBe(403);
    expect((await call('GET', `/api/devices/${ids.central}`, undefined, officeCookie)).status).toBe(403);
    expect((await call('GET', '/api/wireguard/peers', undefined, officeCookie)).status).toBe(403);
    const s = await call('GET', '/api/pppoe/secrets', undefined, officeCookie);
    expect(new Set(s.body.rows.map((x: any) => x.device_id))).toEqual(new Set([ids.devA]));
  });

  it('sem permissão específica: não vê senha, não cria, não acessa usuários/auditoria', async () => {
    const mariaId = routerA.data['/ppp/secret'].find((s) => s.name === 'maria')!['.id'];
    expect((await call('POST', `/api/devices/${ids.devA}/pppoe/secrets/${encodeURIComponent(mariaId)}/password`, { expected_name: 'maria' }, officeCookie)).status).toBe(403);
    expect((await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'x1', password: 'Abc123', profile: 'plano-50' }, officeCookie)).status).toBe(403);
    expect((await call('GET', '/api/users', undefined, officeCookie)).status).toBe(403);
    expect((await call('GET', '/api/audit', undefined, officeCookie)).status).toBe(403);
    expect((await call('GET', `/api/devices/${ids.devA}/modules/firewall`, undefined, officeCookie)).status).toBe(403);
  });

  it('com permissão concedida, cria secret apenas no cliente autorizado', async () => {
    await call('PUT', `/api/users/${officeId}`, {
      name: 'Atendimento', role: 'escritorio', permissions_grant: ['pppoe.create'], client_ids: [ids.clientA], active: true,
    });
    const ok = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'x1', password: 'Abc123', profile: 'plano-50' }, officeCookie);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const denied = await call('POST', `/api/devices/${ids.devB}/pppoe/secrets`, { name: 'x2', password: 'Abc123', profile: 'plano-50' }, officeCookie);
    expect(denied.status).toBe(403);
  });

  it('não permite remover o último administrador', async () => {
    const me = (await call('GET', '/api/auth/me')).body.user;
    const r = await call('PUT', `/api/users/${me.id}`, { name: 'Admin', role: 'tecnico', active: true });
    expect(r.status).toBe(400);
  });
});

describe('falhas de equipamento', () => {
  it('equipamento fora do ar: preserva último dado e marca como desatualizado', async () => {
    await routerA.stop();
    const r = await call('GET', `/api/devices/${ids.devA}/modules/system?refresh=1`);
    expect(r.status).toBe(200);
    expect(r.body.stale).toBe(true);
    expect(r.body.error).toMatch(/recusada|inacess/i);
    expect(r.body.sections.find((s: any) => s.key === 'resource').rows[0].version).toBe('7.16.1 (stable)');
    const d = await call('GET', `/api/devices/${ids.devA}`);
    expect(d.body.status).toBe('unreachable');
    // o peer continua com handshake recente: estados independentes
    expect(d.body.peer_state).toBe('recent');
    const s = await call('GET', `/api/pppoe/secrets?device_id=${ids.devA}`);
    expect(s.body.rows.length).toBeGreaterThan(0);
    const w = await call('POST', `/api/devices/${ids.devA}/pppoe/secrets`, { name: 'y', password: 'Abc123', profile: 'plano-50' });
    expect(w.status).toBe(502);
  });

  it('senha errada no roteador gera status de falha de autenticação', async () => {
    const r = await call('POST', '/api/devices/test', devicePayload({ host: '127.0.0.1', api_port: central.port, password: 'errada' }));
    expect(r.body).toMatchObject({ ok: false, kind: 'auth', status: 'auth_failed' });
    const dev = await call('POST', '/api/devices', devicePayload({ name: 'Senha errada', client_id: ids.clientB, host: '127.0.0.1', api_port: central.port, api_ssl_port: 1, password: 'errada' }));
    const chk = await call('POST', `/api/devices/${dev.body.id}/check`);
    expect(chk.body.status).toBe('auth_failed');
    const dash = await call('GET', '/api/dashboard');
    expect(dash.body.counts).toMatchObject({ auth_failed: 1, unreachable: 1 });
    expect(dash.body.alerts.length).toBeGreaterThanOrEqual(2);
  });
});
