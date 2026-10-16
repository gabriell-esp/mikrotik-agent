/**
 * Notificações WhatsApp: configuração, conexão (QR), destinatários, envio de teste e alertas reais
 * gerados pela coleta (queda e retorno), contra PGlite + roteador de teste + WPPConnect de teste.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeRouterOS, sampleRouter } from './fake-routeros.js';
import { FakeWppConnect } from './fake-wppconnect.js';

const DB_PORT = 54328;
const H = { 'x-requested-with': 'slot1' };
let app: FastifyInstance;
let pgServer: PGLiteSocketServer;
let router: FakeRouterOS;
let wpp: FakeWppConnect;
let q: typeof import('../src/db/pool.js');
let notifier: typeof import('../src/services/notifier.js');
let cache: typeof import('../src/services/module-cache.js');
let registry: typeof import('../src/modules/registry.js');
let cookie = '';

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

/** Executa um ciclo de coleta do módulo sistema e o processamento de alertas. */
async function cycle(deviceId: number) {
  const d = await q.one('SELECT * FROM devices WHERE id = $1', [deviceId]);
  await cache.refreshModule(d, registry.getModule('system')!);
  return notifier.dispatch(await notifier.evaluateAlerts());
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
  notifier = await import('../src/services/notifier.js');
  cache = await import('../src/services/module-cache.js');
  registry = await import('../src/modules/registry.js');
  await migrate(() => {});
  const hash = await hashPassword('Admin12345x');
  await q.query(`INSERT INTO users(username, name, password_hash, role, all_clients) VALUES ('admin','Admin',$1,'admin',TRUE), ('esc','Escritório',$1,'escritorio',FALSE)`, [hash]);
  app = await buildApp({ logger: false });
  router = new FakeRouterOS({ data: sampleRouter() });
  wpp = new FakeWppConnect();
  await Promise.all([router.start(), wpp.start()]);
  cookie = await login('admin', 'Admin12345x');
});

afterAll(async () => {
  await app?.close();
  await q?.pool.end();
  await Promise.all([router?.stop(), wpp?.stop()]);
  await pgServer?.stop();
});

const ids: Record<string, number> = {};

describe('configuração e conexão', () => {
  it('salva configuração sem expor a chave secreta', async () => {
    const r = await call('PUT', '/api/notifications/settings', {
      enabled: true, base_url: wpp.url, session: 'slot1', secret_key: wpp.secret, delay_sec: 0, resource_threshold: 90,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = await call('GET', '/api/notifications/settings');
    expect(s.body).toMatchObject({ enabled: true, has_secret_key: true, session: 'slot1' });
    expect(JSON.stringify(s.body)).not.toContain(wpp.secret);
    const raw = await q.one(`SELECT value FROM settings WHERE key = 'whatsapp'`);
    expect(JSON.stringify(raw)).not.toContain(wpp.secret);
  });

  it('gera token, mostra QR e depois conectado', async () => {
    const st = await call('POST', '/api/notifications/whatsapp/start');
    expect(st.body).toMatchObject({ status: 'QRCODE', connected: false });
    expect(st.body.qrcode).toMatch(/^data:image\/png;base64,/);
    wpp.connected = true;
    const ok = await call('GET', '/api/notifications/whatsapp/status');
    expect(ok.body).toMatchObject({ configured: true, connected: true, status: 'CONNECTED', qrcode: null });
  });

  it('renova o token automaticamente quando é recusado', async () => {
    const before = wpp.tokensIssued;
    wpp.token = 'tok-2';
    const ok = await call('GET', '/api/notifications/whatsapp/status');
    expect(ok.body.connected).toBe(true);
    expect(wpp.tokensIssued).toBe(before + 1);
  });

  it('lista grupos', async () => {
    const g = await call('GET', '/api/notifications/whatsapp/groups');
    expect(g.body).toEqual([{ id: '120363000000000001', name: 'NOC Slot1' }]);
  });

  it('escritório não acessa configurações de notificação', async () => {
    const c = await login('esc', 'Admin12345x');
    expect((await call('GET', '/api/notifications/settings', undefined, c)).status).toBe(403);
  });
});

describe('destinatários e alertas', () => {
  it('cadastra destinatários com número normalizado e valida entradas', async () => {
    ids.client = (await call('POST', '/api/clients', { name: 'Cliente Alfa' })).body.id;
    ids.other = (await call('POST', '/api/clients', { name: 'Cliente Beta' })).body.id;
    const tech = await call('POST', '/api/notifications/recipients', {
      name: 'Plantão', target: '(11) 91234-5678', events: ['device_down', 'device_up', 'device_auth'],
    });
    expect(tech.status, JSON.stringify(tech.body)).toBe(200);
    expect(tech.body.target).toBe('5511912345678');
    ids.tech = tech.body.id;
    const grp = await call('POST', '/api/notifications/recipients', {
      name: 'Grupo Beta', target: '120363000000000001@g.us', is_group: true, events: ['device_down'], client_ids: [ids.other],
    });
    expect(grp.body.target).toBe('120363000000000001');
    expect((await call('POST', '/api/notifications/recipients', { name: 'Dup', target: '11912345678', events: ['device_down'] })).status).toBe(409);
    expect((await call('POST', '/api/notifications/recipients', { name: 'Ruim', target: '123', events: ['device_down'] })).status).toBe(400);
    expect((await call('POST', '/api/notifications/recipients', { name: 'Sem evento', target: '11988887777', events: [] })).status).toBe(400);
  });

  it('envia mensagem de teste', async () => {
    const r = await call('POST', '/api/notifications/test', { recipient_id: ids.tech });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(wpp.sent.at(-1)).toMatchObject({ phone: '5511912345678', isGroup: false });
    expect(wpp.sent.at(-1)!.message).toMatch(/Teste de notificação/);
  });

  it('queda e retorno do equipamento geram mensagens (uma vez cada) para quem tem o cliente no escopo', async () => {
    const d = await call('POST', '/api/devices', {
      name: 'RB Alfa', client_id: ids.client, host: '127.0.0.1', api_method: 'api', allow_plaintext: true,
      api_port: router.port, username: 'api', password: 'secret', poll_enabled: true,
    });
    ids.dev = d.body.id;
    wpp.sent = [];
    expect(await cycle(ids.dev)).toBe(0); // primeira coleta: só registra o estado

    await q.query('UPDATE devices SET api_port = 1 WHERE id = $1', [ids.dev]); // "derruba" o acesso
    expect(await cycle(ids.dev)).toBe(1);
    expect(wpp.sent).toHaveLength(1); // grupo do Cliente Beta não recebe
    expect(wpp.sent[0].phone).toBe('5511912345678');
    expect(wpp.sent[0].message).toMatch(/🔴 \*Equipamento inacessível\*/);
    expect(wpp.sent[0].message).toMatch(/Cliente Alfa/);

    expect(await cycle(ids.dev)).toBe(0); // continua fora: não repete

    await q.query('UPDATE devices SET api_port = $2 WHERE id = $1', [ids.dev, router.port]);
    expect(await cycle(ids.dev)).toBe(1);
    expect(wpp.sent[1].message).toMatch(/🟢 \*Equipamento normalizado\*/);
    expect(wpp.sent[1].message).toMatch(/Voltou a responder/);
  });

  it('atraso anti-oscilação: queda curta não notifica', async () => {
    await q.query(`UPDATE settings SET value = jsonb_set(value, '{delay_sec}', '300') WHERE key = 'whatsapp'`);
    wpp.sent = [];
    await q.query('UPDATE devices SET api_port = 1 WHERE id = $1', [ids.dev]);
    expect(await cycle(ids.dev)).toBe(0);
    await q.query('UPDATE devices SET api_port = $2 WHERE id = $1', [ids.dev, router.port]);
    expect(await cycle(ids.dev)).toBe(0);
    expect(wpp.sent).toHaveLength(0);
    await q.query(`UPDATE settings SET value = jsonb_set(value, '{delay_sec}', '0') WHERE key = 'whatsapp'`);
  });

  it('CPU alta gera um alerta e não repete', async () => {
    await call('PUT', `/api/notifications/recipients/${ids.tech}`, {
      name: 'Plantão', target: '5511912345678', events: ['device_down', 'device_up', 'resource_high'],
    });
    router.data['/system/resource'][0]['cpu-load'] = '97';
    wpp.sent = [];
    expect(await cycle(ids.dev)).toBe(1);
    expect(wpp.sent[0].message).toMatch(/CPU em 97%/);
    expect(await cycle(ids.dev)).toBe(0);
  });

  it('falha temporária do WhatsApp é repetida e o histórico registra tentativas', async () => {
    wpp.failSends = 1;
    const r = await call('POST', '/api/notifications/test', { recipient_id: ids.tech });
    expect(r.status).toBe(200);
    const log = await call('GET', '/api/notifications/log');
    expect(log.body.rows[0]).toMatchObject({ success: true, attempts: 2 });
    expect(log.body.total).toBeGreaterThanOrEqual(4);
  });

  it('mensagem agrupada quando há vários alertas', () => {
    const dev = (id: number, name: string) => ({ id, name, host: '10.0.0.' + id, client_id: 1, client_name: 'X', is_central: false });
    const msg = notifier.buildMessage([
      { event: 'device_up', device: dev(1, 'A'), detail: '', since: new Date() },
      { event: 'device_down', device: dev(2, 'B'), detail: 'sem resposta', since: new Date() },
    ]);
    expect(msg).toMatch(/2 alertas/);
    expect(msg.indexOf('🔴')).toBeLessThan(msg.indexOf('🟢'));
  });

  it('desconexão do WhatsApp', async () => {
    expect((await call('POST', '/api/notifications/whatsapp/logout')).status).toBe(200);
    expect((await call('GET', '/api/notifications/whatsapp/status')).body.connected).toBe(false);
  });
});
