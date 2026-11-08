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

// Contato padrão das ordens (obrigatório).
const C = [{ name: 'Sr. João (síndico)', phone: '(49) 99999-0000' }];

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
    expect((await call('POST', '/api/os', { contacts: C, title: 'Sem permissão' }, 'tec')).status).toBe(403);
    expect((await call('POST', '/api/os', { contacts: C, title: 'Para o escritório', assigned_to: ids.esc })).status).toBe(400);
    const e = await call('POST', '/api/os', { contacts: C, title: 'Aberta pelo escritório', client_id: ids.client, assigned_to: ids.tec2 }, 'esc');
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect(e.body).toMatchObject({ status: 'aberta', assigned_name: 'TEC2', created_by_name: 'ESC', client_name: 'Condomínio Alfa' });
  });

  it('técnico vê só as ordens atribuídas a ele; escritório não vê cliente fora do escopo', async () => {
    const o = await call('POST', '/api/os', { contacts: C, title: 'Trocar antena do bloco B', description: 'Sem sinal no 3º andar', client_id: ids.client, priority: 'alta', assigned_to: ids.tec, location: 'Bloco B' });
    expect(o.status).toBe(200);
    ids.os = o.body.id;
    ids.beta = (await call('POST', '/api/os', { contacts: C, title: 'Visita no Beta', client_id: ids.other })).body.id;
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
    ids.os2 = (await call('POST', '/api/os', { contacts: C, title: 'Segunda ordem', client_id: ids.client, assigned_to: ids.tec })).body.id;
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
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Cabo UTP cat6', quantity: 25.5, unit: 'm' }, 'tec')).status).toBe(200);
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Conector RJ45', quantity: 4 }, 'tec')).status).toBe(200);
    expect((await call('POST', `${base}/items`, { kind: 'compra', store: 'Loja do Zé', description: 'Fita isolante e abraçadeiras', amount: 32.9 }, 'tec')).status).toBe(200);
    // Material não guarda valor (campo extra é ignorado); compra exige loja e valor.
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Switch', quantity: 1, amount: 300 }, 'tec')).status).toBe(200);
    expect((await call('POST', `${base}/items`, { kind: 'compra', description: 'Sem loja', amount: 10 }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/items`, { kind: 'compra', store: 'Loja', description: 'Sem valor' }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'x', quantity: 0 }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Cabo', quantity: 1, unit: 'kg' }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Abraçadeira', quantity: 1 }, 'tec2')).status).toBe(403);
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
    expect(d.body).toMatchObject({ total_cost: 32.9, report: 'Rascunho' });
    expect(d.body.photos).toHaveLength(1);
    expect(d.body.items.map((i: any) => [i.kind, i.description, i.quantity, i.unit, i.store, i.amount])).toEqual([
      ['material', 'Cabo UTP cat6', 25.5, 'm', null, null],
      ['material', 'Conector RJ45', 4, 'un', null, null],
      ['compra', 'Fita isolante e abraçadeiras', 1, 'un', 'Loja do Zé', 32.9],
      ['material', 'Switch', 1, 'un', null, null],
    ]);
    // Tamanho de foto real de celular já reduzida (~900 KB) e miniatura (~60 KB).
    const big = await call('POST', `${base}/photos`, { image: jpeg(900_000), thumb: jpeg(60_000) }, 'tec');
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(((await call('GET', `${base}/photos/${big.body.id}`, undefined, 'tec')).body as Buffer).length).toBe(900_004);
    expect((await call('DELETE', `${base}/photos/${big.body.id}`, {}, 'tec')).status).toBe(200);
    const extra = await call('POST', `${base}/photos`, { image: jpeg(), thumb: jpeg(100) }, 'tec');
    expect((await call('DELETE', `${base}/photos/${extra.body.id}`, {}, 'tec')).status).toBe(200);
    expect((await call('DELETE', `${base}/items/${d.body.items[2].id}`, {}, 'tec')).status).toBe(200);
    const after = (await call('GET', base, undefined, 'tec')).body;
    expect([after.photos.length, after.total_cost, after.items.length]).toEqual([1, 0, 3]);
  });

  it('finaliza exigindo relatório; depois de concluída só o gestor reabre', async () => {
    const base = `/api/os/${ids.os}`;
    // Sem texto no envio, vale o rascunho salvo; sem rascunho, não conclui.
    await call('PUT', `${base}/report`, { report: '' }, 'tec');
    expect((await call('POST', `${base}/finish`, { report: '' }, 'tec')).status).toBe(400);
    const f = await call('POST', `${base}/finish`, { report: 'Antena substituída e alinhada. Sinal -58 dBm no 3º andar.' }, 'tec');
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ status: 'concluida', running_since: null });
    expect(f.body.finished_at).toBeTruthy();
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Depois do fim', quantity: 1 }, 'tec')).status).toBe(403);
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
    const re = await call('PUT', base, { title: cur.title, contacts: cur.contacts, client_id: ids.client, assigned_to: ids.tec2, priority: 'urgente' });
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

describe('planejamento (ordens futuras, orçamentos e lembretes)', () => {
  it('só quem tem a permissão acessa; administrador cria, lista por prazo e conta atrasados', async () => {
    expect((await call('GET', '/api/planner', undefined, 'tec')).status).toBe(403);
    expect((await call('GET', '/api/planner', undefined, 'esc')).status).toBe(403);
    const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
    const a = await call('POST', '/api/planner', {
      kind: 'orcamento', title: 'Orçamento CFTV portaria', client_id: ids.client, due_date: day(3), amount: 4500, notes: '4 câmeras + DVR',
      checklist: [{ text: 'Visita técnica' }, { text: 'Enviar proposta' }],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toMatchObject({ kind: 'orcamento', status: 'pendente', amount: 4500, due_date: day(3), client_name: 'Condomínio Alfa', created_by_name: 'Admin' });
    expect(a.body.checklist).toEqual([{ text: 'Visita técnica', done: false }, { text: 'Enviar proposta', done: false }]);
    ids.plan = a.body.id;
    ids.late = (await call('POST', '/api/planner', { kind: 'os_futura', title: 'Trocar nobreak do rack', due_date: day(-2), priority: 'alta' })).body.id;
    await call('POST', '/api/planner', { kind: 'lembrete', title: 'Renovar domínio' });
    expect((await call('POST', '/api/planner', { title: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/planner', { title: 'Data ruim', due_date: '31/12/2026' })).status).toBe(400);

    const list = await call('GET', '/api/planner');
    expect(list.body.rows.map((r: any) => r.title)).toEqual(['Trocar nobreak do rack', 'Orçamento CFTV portaria', 'Renovar domínio']);
    expect(list.body.counts).toMatchObject({ os_futura: { open: 1, overdue: 1 }, orcamento: { open: 1, overdue: 0 }, lembrete: { open: 1 } });
    expect((await call('GET', '/api/planner?kind=orcamento')).body.rows).toHaveLength(1);
    expect((await call('GET', '/api/planner?q=cftv')).body.rows[0].id).toBe(ids.plan);
  });

  it('marca checklist e situação, gera OS a partir do item e exclui deixando registro', async () => {
    const ck = await call('PUT', `/api/planner/${ids.plan}/checklist`, { checklist: [{ text: 'Visita técnica', done: true }, { text: 'Enviar proposta', done: false }] });
    expect(ck.body.checklist[0].done).toBe(true);
    const st = await call('POST', `/api/planner/${ids.plan}/status`, { status: 'aguardando' });
    expect(st.body).toMatchObject({ status: 'aguardando', done_at: null });
    const done = await call('POST', `/api/planner/${ids.plan}/status`, { status: 'concluido' });
    expect(done.body.done_at).toBeTruthy();
    expect((await call('GET', '/api/planner')).body.rows.map((r: any) => r.id)).not.toContain(ids.plan);
    expect((await call('GET', '/api/planner?view=encerrados')).body.rows.map((r: any) => r.id)).toContain(ids.plan);

    const os = await call('POST', '/api/os', { contacts: C, title: 'Trocar nobreak do rack', priority: 'alta', assigned_to: ids.tec });
    const link = await call('POST', `/api/planner/${ids.late}/link`, { service_order_id: os.body.id });
    expect(link.body).toMatchObject({ status: 'concluido', service_order_id: os.body.id, service_order_status: 'aberta' });
    expect((await call('POST', `/api/planner/${ids.late}/link`, { service_order_id: 99999 })).status).toBe(400);

    const ed = await call('PUT', `/api/planner/${ids.plan}`, { ...done.body, status: 'pendente', title: 'Orçamento CFTV portaria (revisado)' });
    expect(ed.body).toMatchObject({ status: 'pendente', done_at: null, title: 'Orçamento CFTV portaria (revisado)', updated_by_name: 'Admin' });
    expect((await call('DELETE', `/api/planner/${ids.plan}`)).status).toBe(200);
    expect((await call('GET', '/api/planner?view=todos')).body.rows.map((r: any) => r.id)).not.toContain(ids.plan);
    const log = await q.one("SELECT details FROM audit_log WHERE action = 'planner.delete' ORDER BY id DESC LIMIT 1");
    expect(log.details).toMatchObject({ kind: 'orcamento', notes: '4 câmeras + DVR' });
  });
});

describe('contatos obrigatórios e dupla de técnicos', () => {
  it('exige ao menos um contato com telefone válido e guarda só os dígitos', async () => {
    const none = await call('POST', '/api/os', { title: 'Sem contato', assigned_to: ids.tec });
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/ao menos um contato/);
    expect((await call('POST', '/api/os', { title: 'Telefone ruim', contacts: [{ name: 'Fulano', phone: '1234' }] })).status).toBe(400);
    const ok = await call('POST', '/api/os', { title: 'Dupla na portaria', contacts: [{ name: 'Portaria', phone: '+55 (49) 3555-1234' }, ...C], client_id: ids.client, assigned_to: ids.tec });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.contacts).toEqual([{ name: 'Portaria', phone: '554935551234' }, { name: 'Sr. João (síndico)', phone: '49999990000' }]);
    ids.duo = ok.body.id;
    expect((await call('POST', '/api/os', { title: 'Auxiliar sem responsável', contacts: C, helper_id: ids.tec2 })).status).toBe(400);
  });

  it('o técnico responsável chama o companheiro, que passa a ver e trabalhar na ordem', async () => {
    const base = `/api/os/${ids.duo}`;
    // A ordem #os (reaberta e pausada) não deve bloquear; garante que nenhuma outra do tec está rodando.
    await q.query(`UPDATE service_orders SET status = 'pausada' WHERE status = 'em_andamento'`);
    await q.query('UPDATE service_order_time SET ended_at = now() WHERE ended_at IS NULL');
    const opts = await call('GET', `${base}/helper-options`, undefined, 'tec');
    expect(opts.status).toBe(200);
    expect(opts.body.map((u: any) => u.username)).not.toContain('tec');
    expect((await call('POST', `${base}/helper`, { helper_id: ids.tec2 }, 'tec2')).status).toBe(403);
    expect((await call('POST', `${base}/helper`, { helper_id: ids.tec }, 'tec')).status).toBe(400);
    expect((await call('POST', `${base}/helper`, { helper_id: ids.esc }, 'tec')).status).toBe(400);
    const h = await call('POST', `${base}/helper`, { helper_id: ids.tec2 }, 'tec');
    expect(h.body).toMatchObject({ helper_id: ids.tec2, helper_name: 'TEC2', assigned_name: 'TEC' });
    expect((await call('GET', '/api/os', undefined, 'tec2')).body.rows.map((r: any) => r.id)).toContain(ids.duo);
    const d = await call('GET', base, undefined, 'tec2');
    expect(d.body.can).toMatchObject({ execute: true, principal: false, work: true, setHelper: false, confirmed: false });
    expect((await call('POST', `${base}/items`, { kind: 'material', description: 'Cabo', quantity: 3, unit: 'm' }, 'tec2')).status).toBe(200);
    expect((await call('POST', `${base}/start`, {}, 'tec2')).status).toBe(200);
    // O companheiro também conta como "em andamento" para o limite de uma ordem por vez.
    const other = await call('POST', '/api/os', { title: 'Outra do tec2', contacts: C, assigned_to: ids.tec2 });
    expect((await call('POST', `/api/os/${other.body.id}/start`, {}, 'tec2')).status).toBe(409);
  });

  it('com dois técnicos, a ordem só conclui quando os dois finalizam', async () => {
    const base = `/api/os/${ids.duo}`;
    expect((await call('POST', `${base}/finish`, { report: 'Feito pelo admin' })).status).toBe(403);
    const first = await call('POST', `${base}/finish`, { report: 'Rack reorganizado e cabos identificados.' }, 'tec');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'pausada', running_since: null, finished_at: null });
    expect(first.body.assigned_done_at).toBeTruthy();
    expect(first.body.helper_done_at).toBeNull();
    expect((await call('GET', base, undefined, 'tec')).body.can.confirmed).toBe(true);
    // Se alguém volta a trabalhar, as confirmações recomeçam.
    await call('POST', `${base}/start`, {}, 'tec2');
    expect((await call('GET', base, undefined, 'tec')).body.assigned_done_at).toBeNull();
    await call('POST', `${base}/finish`, {}, 'tec');
    const last = await call('POST', `${base}/finish`, {}, 'tec2');
    expect(last.body).toMatchObject({ status: 'concluida', report: 'Rack reorganizado e cabos identificados.' });
    expect(last.body.finished_at).toBeTruthy();
    const kinds = (await call('GET', base)).body.events.map((e: any) => e.kind);
    expect(kinds.filter((k: string) => k === 'finalizacao_confirmada')).toHaveLength(3);
    expect(kinds.at(-1)).toBe('concluida');
  });
});

describe('perfil e exclusão automática de usuários', () => {
  it('cada usuário edita o próprio perfil e envia a foto', async () => {
    expect((await call('PUT', '/api/profile', { name: 'Técnico Um', phone: '123' }, 'tec')).status).toBe(400);
    const p = await call('PUT', '/api/profile', { name: 'Técnico Um', email: 'tec@slot1.info', phone: '(49) 98888-7777' }, 'tec');
    expect(p.body).toMatchObject({ name: 'Técnico Um', phone: '49988887777', email: 'tec@slot1.info' });
    expect((await call('PUT', '/api/profile/avatar', { image: Buffer.from('nao e jpeg').toString('base64') }, 'tec')).status).toBe(400);
    const av = await call('PUT', '/api/profile/avatar', { image: jpeg(5000) }, 'tec');
    expect(av.body.avatar_updated_at).toBeTruthy();
    const img = await call('GET', `/api/users/${ids.tec}/avatar`, undefined, 'tec2');
    expect(img.status).toBe(200);
    expect(img.headers['cache-control']).toBe('private, max-age=604800');
    expect((await call('GET', `/api/users/${ids.tec2}/avatar`, undefined, 'tec')).status).toBe(404);
    const me = await call('GET', '/api/auth/me', undefined, 'tec');
    expect(me.body.user.avatarUpdatedAt).toBeTruthy();
    const list = await call('GET', `/api/os/${ids.duo}`);
    expect(list.body.assigned_avatar).toBeTruthy();
  });

  it('exclui quem está desativado há mais dias que o configurado', async () => {
    const { purgeInactiveUsers } = await import('../src/services/user-cleanup.js');
    expect((await call('GET', '/api/users/settings', undefined, 'tec')).status).toBe(403);
    expect((await call('GET', '/api/users/settings')).body).toEqual({ auto_delete_days: 0 });
    const u = await call('POST', '/api/users', { username: 'temporario', name: 'Temporário', role: 'tecnico', password: 'Senha12345x', must_change_password: false });
    const put = (active: boolean) => call('PUT', `/api/users/${u.body.id}`, { name: 'Temporário', role: 'tecnico', active });
    expect((await put(false)).body.deactivated_at).toBeTruthy();
    expect((await put(true)).body.deactivated_at).toBeNull();
    await put(false);
    await q.query(`UPDATE users SET deactivated_at = now() - interval '31 days' WHERE id = $1`, [u.body.id]);
    expect(await purgeInactiveUsers()).toEqual([]); // desligada (0 dias)
    expect((await call('PUT', '/api/users/settings', { auto_delete_days: -1 })).status).toBe(400);
    expect((await call('PUT', '/api/users/settings', { auto_delete_days: 45 })).body).toEqual({ auto_delete_days: 45 });
    expect(await purgeInactiveUsers()).toEqual([]); // 31 dias < 45
    await call('PUT', '/api/users/settings', { auto_delete_days: 30 });
    expect(await purgeInactiveUsers()).toEqual(['temporario']);
    expect(await q.one('SELECT 1 FROM users WHERE id = $1', [u.body.id])).toBeUndefined();
    const log = await q.one(`SELECT target, details FROM audit_log WHERE action = 'user.auto_delete'`);
    expect(log).toMatchObject({ target: 'temporario', details: { days: 30, name: 'Temporário' } });
    // Usuário ativo nunca é excluído.
    expect(await q.one(`SELECT 1 FROM users WHERE username = 'tec'`)).toBeTruthy();
  });
});
