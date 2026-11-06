/**
 * Ordens de serviço: permissões, cronômetro, relatório, gastos e fotos (PGlite).
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_PORT = 54326;
const H = { 'x-requested-with': 'slot1' };
let app: FastifyInstance;
let pgServer: PGLiteSocketServer;
let q: typeof import('../src/db/pool.js');
const s: Record<string, string> = {};
const ids: Record<string, number> = {};

async function call(method: string, url: string, body?: unknown, who = 'admin') {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...H, cookie: s[who] } });
  const json = res.headers['content-type']?.toString().includes('json');
  return { status: res.statusCode, body: json && res.body ? JSON.parse(res.body) : res.rawPayload, headers: res.headers };
}
async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: H });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  return String(Array.isArray(set) ? set[0] : set).split(';')[0];
}
async function newUser(username: string, role: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/api/users', { username, name: username.toUpperCase(), role, password: 'Senha12345x', must_change_password: false, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  s[username] = await login(username, 'Senha12345x');
  return r.body.id as number;
}

// JPEG mínimo (cabeçalho válido) para os testes de upload.
const jpeg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]).toString('base64');

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
  s.admin = await login('admin', 'Admin12345x');
  ids.client = (await call('POST', '/api/clients', { name: 'Condomínio Alfa' })).body.id;
  ids.other = (await call('POST', '/api/clients', { name: 'Condomínio Beta' })).body.id;
  ids.tec = await newUser('tec', 'tecnico', { client_ids: [ids.client] });
  ids.tec2 = await newUser('tec2', 'tecnico', { client_ids: [ids.client] });
  ids.esc = await newUser('esc', 'escritorio', { client_ids: [ids.client] });
});

afterAll(async () => {
  await app?.close();
  await q?.pool.end();
  await pgServer?.stop();
});

describe('abertura e atribuição', () => {
  it('lista de responsáveis traz só quem executa ordens; escritório pode abrir, técnico não', async () => {
    const a = await call('GET', '/api/os/assignees');
    expect(a.body.map((u: any) => u.username).sort()).toEqual(['admin', 'tec', 'tec2']);
    expect((await call('POST', '/api/os', { title: 'Sem permissão' }, 'tec')).status).toBe(403);
    expect((await call('POST', '/api/os', { title: 'Para o escritório', assigned_to: ids.esc })).status).toBe(400);
    const e = await call('POST', '/api/os', { title: 'Aberta pelo escritório', client_id: ids.client, assigned_to: ids.tec2 }, 'esc');
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect(e.body).toMatchObject({ status: 'aberta', assigned_name: 'TEC2', created_by_name: 'ESC', client_name: 'Condomínio Alfa' });
  });

  it('técnico vê só as ordens atribuídas a ele; escritório não vê cliente fora do escopo', async () => {
    const o = await call('POST', '/api/os', { title: 'Trocar antena do bloco B', description: 'Sem sinal no 3º andar', client_id: ids.client, priority: 'alta', assigned_to: ids.tec, location: 'Bloco B' });
    expect(o.status).toBe(200);
    ids.os = o.body.id;
    ids.beta = (await call('POST', '/api/os', { title: 'Visita no Beta', client_id: ids.other })).body.id;
    const mine = await call('GET', '/api/os', undefined, 'tec');
    expect(mine.body.rows.map((r: any) => r.id)).toEqual([ids.os]);
    expect((await call('GET', `/api/os/${ids.os}`, undefined, 'tec2')).status).toBe(403);
    expect((await call('GET', `/api/os/${ids.beta}`, undefined, 'esc')).status).toBe(403);
    const esc = await call('GET', '/api/os', { }, 'esc');
    expect(esc.body.rows.map((r: any) => r.id)).not.toContain(ids.beta);
    const all = await call('GET', '/api/os?q=antena');
    expect(all.body.rows.map((r: any) => r.id)).toEqual([ids.os]);
    expect((await call('GET', `/api/os?q=%23${ids.os}`)).body.rows[0].id).toBe(ids.os);
  });
});

describe('execução pelo técnico', () => {
  it('inicia, impede duas ordens simultâneas, pausa e retoma com tempo acumulado', async () => {
    expect((await call('POST', `/api/os/${ids.os}/start`, {}, 'tec2')).status).toBe(403);
    expect((await call('POST', `/api/os/${ids.os}/finish`, { report: 'Nada feito ainda' }, 'tec')).status).toBe(400);
    const st = await call('POST', `/api/os/${ids.os}/start`, {}, 'tec');
    expect(st.status).toBe(200);
    expect(st.body.status).toBe('em_andamento');
    expect(st.body.running_since).toBeTruthy();
    ids.os2 = (await call('POST', '/api/os', { title: 'Segunda ordem', client_id: ids.client, assigned_to: ids.tec })).body.id;
    const two = await call('POST', `/api/os/${ids.os2}/start`, {}, 'tec');
    expect(two.status).toBe(409);
    expect(two.body.message).toContain(`OS #${ids.os}`);
    // Simula 10 minutos de trabalho no período aberto.
    await q.query(`UPDATE service_order_time SET started_at = now() - interval '10 minutes' WHERE order_id = $1 AND ended_at IS NULL`, [ids.os]);
    const p = await call('POST', `/api/os/${ids.os}/pause`, {}, 'tec');
    expect(p.body).toMatchObject({ status: 'pausada', running_since: null });
    expect(p.body.work_seconds).toBeGreaterThanOrEqual(600);
    const r = await call('POST', `/api/os/${ids.os}/start`, {}, 'tec');
    expect(r.body.status).toBe('em_andamento');
    const d = await call('GET', `/api/os/${ids.os}`, undefined, 'tec');
    expect(d.body.events.map((e: any) => e.kind)).toEqual(['criada', 'iniciada', 'pausada', 'retomada']);
    expect(d.body.can).toMatchObject({ execute: true, work: true, manage: false });
  });

  it('lança gastos, salva o relatório e envia/abre/remove fotos', async () => {
    const base = `/api/os/${ids.os}`;
    expect((await call('POST', `${base}/items`, { description: 'Cabo UTP cat6 (m)', quantity: 25, unit_price: 2.5 }, 'tec')).status).toBe(200);
    expect((await call('POST', `${base}/items`, { kind: 'despesa', description: 'Estacionamento', quantity: 1, unit_price: 15 }, 'tec')).status).toBe(200);
    expect((await call('POST', `${base}/items`, { description: 'x', quantity: 0 }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/items`, { description: 'Abraçadeira' }, 'tec2')).status).toBe(403);
    expect((await call('PUT', `${base}/report`, { report: 'Rascunho' }, 'tec')).status).toBe(200);

    const up = await call('POST', `${base}/photos`, { image: jpeg(), thumb: jpeg(200), caption: 'Antes' }, 'tec');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const bad = await call('POST', `${base}/photos`, { image: Buffer.from('<svg onload=alert(1)>').toString('base64'), thumb: jpeg(50) }, 'tec');
    expect(bad.status).toBe(400);
    const img = await call('GET', `${base}/photos/${up.body.id}`, undefined, 'tec');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((img.body as Buffer).length).toBe(2004);
    expect((await call('GET', `${base}/photos/${up.body.id}?thumb=1`, undefined, 'tec2')).status).toBe(403);

    const d = await call('GET', base, undefined, 'tec');
    expect(d.body).toMatchObject({ total_cost: 77.5, report: 'Rascunho' });
    expect(d.body.photos).toHaveLength(1);
    expect(d.body.items.map((i: any) => [i.kind, i.quantity, i.unit_price])).toEqual([['material', 25, 2.5], ['despesa', 1, 15]]);
    // Tamanho de foto real de celular já reduzida (~900 KB) e miniatura (~60 KB).
    const big = await call('POST', `${base}/photos`, { image: jpeg(900_000), thumb: jpeg(60_000) }, 'tec');
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(((await call('GET', `${base}/photos/${big.body.id}`, undefined, 'tec')).body as Buffer).length).toBe(900_004);
    expect((await call('DELETE', `${base}/photos/${big.body.id}`, {}, 'tec')).status).toBe(200);
    const extra = await call('POST', `${base}/photos`, { image: jpeg(), thumb: jpeg(100) }, 'tec');
    expect((await call('DELETE', `${base}/photos/${extra.body.id}`, {}, 'tec')).status).toBe(200);
    expect((await call('DELETE', `${base}/items/${d.body.items[1].id}`, {}, 'tec')).status).toBe(200);
    const after = (await call('GET', base, undefined, 'tec')).body;
    expect([after.photos.length, after.total_cost]).toEqual([1, 62.5]);
  });

  it('finaliza exigindo relatório; depois de concluída só o gestor reabre', async () => {
    const base = `/api/os/${ids.os}`;
    expect((await call('POST', `${base}/finish`, { report: '' }, 'tec')).status).toBe(400);
    const f = await call('POST', `${base}/finish`, { report: 'Antena substituída e alinhada. Sinal -58 dBm no 3º andar.' }, 'tec');
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ status: 'concluida', running_since: null });
    expect(f.body.finished_at).toBeTruthy();
    expect((await call('POST', `${base}/items`, { description: 'Depois do fim' }, 'tec')).status).toBe(403);
    expect((await call('POST', `${base}/reopen`, {}, 'tec')).status).toBe(403);
    const ro = await call('POST', `${base}/reopen`, {});
    expect(ro.body.status).toBe('pausada');
    const audit = await q.query(`SELECT action FROM audit_log WHERE action LIKE 'os.%' ORDER BY id`);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['os.create', 'os.finish', 'os.reopen']));
  });

  it('gestor reatribui (pausando o cronômetro) e cancela com motivo', async () => {
    const base = `/api/os/${ids.os2}`;
    expect((await call('POST', `${base}/start`, {}, 'tec')).status).toBe(200); // a primeira voltou pausada
    const cur = (await call('GET', base)).body;
    const re = await call('PUT', base, { title: cur.title, client_id: ids.client, assigned_to: ids.tec2, priority: 'urgente' });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(re.body).toMatchObject({ status: 'pausada', running_since: null, assigned_name: 'TEC2', priority: 'urgente' });
    expect((await call('GET', base, undefined, 'tec')).status).toBe(403);
    expect((await call('GET', base, undefined, 'tec2')).body.can.execute).toBe(true);
    expect((await call('POST', `${base}/cancel`, {}, 'tec2')).status).toBe(403);
    expect((await call('POST', `${base}/cancel`, { reason: '' })).status).toBe(400);
    const c = await call('POST', `${base}/cancel`, { reason: 'Cliente resolveu sozinho' });
    expect(c.body).toMatchObject({ status: 'cancelada', cancel_reason: 'Cliente resolveu sozinho' });
    expect((await call('PUT', base, { title: 'x x x' })).status).toBe(400);
    const tabs = await call('GET', '/api/os?status=todas');
    expect(tabs.body.counts).toMatchObject({ cancelada: 1, pausada: 1, aberta: 2 });
  });
});
