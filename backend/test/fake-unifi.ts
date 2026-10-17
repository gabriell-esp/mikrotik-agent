/**
 * Controladora UniFi de TESTE (UniFi OS ou controlador antigo), apenas para testes automatizados.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Mode = 'unifios' | 'legacy';

export class FakeUnifi {
  server: http.Server;
  url = '';
  username = 'apiuser';
  password = 'Senha123';
  logins = 0;
  commands: { path: string; body: any }[] = [];
  private tokens = new Set<string>();
  private csrf = 'csrf-' + randomBytes(4).toString('hex');

  data: Record<string, { devices: any[]; clients: any[]; wlans: any[]; users: any[] }> = {
    default: {
      devices: [
        { _id: 'd1', mac: 'aa:bb:cc:00:00:01', name: 'AP Hall', model: 'U7PG2', type: 'uap', ip: '192.168.1.20', version: '6.6.55', state: 1, num_sta: 2, uptime: 3600, upgradable: true, upgrade_to_firmware: '6.6.77', x_authkey: 'SEGREDO-AP',
          radio_table_stats: [{ name: 'ra0', radio: 'ng', channel: 6, tx_power: 20, num_sta: 1, cu_total: 30, satisfaction: 98 }, { name: 'rai0', radio: 'na', channel: 36, tx_power: 23, num_sta: 1 }] },
        { _id: 'd2', mac: 'aa:bb:cc:00:00:02', name: 'AP Garagem', model: 'UAL6', type: 'uap', ip: '192.168.1.21', version: '6.6.77', state: 0, num_sta: 0 },
      ],
      clients: [
        { mac: '11:22:33:44:55:01', hostname: 'celular-joao', ip: '192.168.1.100', ap_mac: 'aa:bb:cc:00:00:01', essid: 'Condominio', signal: -55, radio: 'na', channel: 36, tx_rate: 433000, rx_rate: 400000, uptime: 600 },
        { mac: '11:22:33:44:55:02', name: 'TV Sala', ip: '192.168.1.101', ap_mac: 'aa:bb:cc:00:00:01', essid: 'Condominio', signal: -70, radio: 'ng' },
      ],
      wlans: [
        { _id: '5f0000000000000000000001', name: 'Condominio', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', x_passphrase: 'SENHA-WIFI-SECRETA', wlan_bands: ['2g', '5g'] },
        { _id: '5f0000000000000000000002', name: 'Visitantes', enabled: true, security: 'wpapsk', is_guest: true, x_passphrase: 'OUTRA-SENHA' },
      ],
      users: [{ mac: '11:22:33:44:55:99', hostname: 'bloqueado', blocked: true }],
    },
  };

  constructor(public mode: Mode = 'unifios') {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => this.handle(req, res, body ? JSON.parse(body) : undefined));
    });
  }

  async start(port = 0) {
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  /** Invalida as sessões (simula expiração). */
  expireSessions() {
    this.tokens.clear();
  }

  private cookie(req: http.IncomingMessage, name: string) {
    return (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
    const send = (code: number, data: unknown, headers: Record<string, string | string[]> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };
    const ok = (data: unknown) => send(200, this.mode === 'legacy' ? { meta: { rc: 'ok' }, data } : { meta: { rc: 'ok' }, data });
    let path = req.url ?? '';

    // ---- login
    if (this.mode === 'unifios' && path === '/api/auth/login' && req.method === 'POST') {
      if (body?.username !== this.username || body?.password !== this.password) return send(401, { message: 'Invalid username or password' });
      const t = randomBytes(8).toString('hex');
      this.tokens.add(t);
      this.logins++;
      return send(200, { username: this.username }, { 'set-cookie': [`TOKEN=${t}; Path=/; HttpOnly`], 'x-csrf-token': this.csrf });
    }
    if (this.mode === 'legacy' && path === '/api/login' && req.method === 'POST') {
      if (body?.username !== this.username || body?.password !== this.password) return send(400, { meta: { rc: 'error', msg: 'api.err.Invalid' }, data: [] });
      const t = randomBytes(8).toString('hex');
      this.tokens.add(t);
      this.logins++;
      return send(200, { meta: { rc: 'ok' }, data: [] }, { 'set-cookie': [`unifises=${t}; Path=/`, `csrf_token=${this.csrf}; Path=/`] });
    }
    if (path === '/api/auth/login' || path === '/api/login') return send(404, { message: 'not found' });

    // ---- autenticação das demais rotas
    if (this.mode === 'unifios') {
      if (!path.startsWith('/proxy/network')) return send(404, {});
      path = path.slice('/proxy/network'.length);
      if (!this.tokens.has(this.cookie(req, 'TOKEN') ?? '')) return send(401, { message: 'Unauthorized' });
    } else if (!this.tokens.has(this.cookie(req, 'unifises') ?? '')) {
      return send(401, { meta: { rc: 'error', msg: 'api.err.LoginRequired' }, data: [] });
    }
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== this.csrf) return send(403, { message: 'CSRF' });

    if (path === '/api/self/sites') return ok([{ _id: 's1', name: 'default', desc: 'Condomínio Teste' }]);
    const m = path.match(/^\/api\/s\/([^/]+)\/(.+)$/);
    if (!m) return send(404, {});
    const site = this.data[m[1]];
    if (!site) return send(400, { meta: { rc: 'error', msg: 'api.err.NoSiteContext' }, data: [] });
    const rest = m[2];
    if (req.method !== 'GET') this.commands.push({ path: rest, body });
    switch (true) {
      case rest === 'stat/sysinfo': return ok([{ version: '8.6.9' }]);
      case rest === 'stat/device': return ok(site.devices);
      case rest === 'stat/sta': return ok(site.clients);
      case rest === 'rest/wlanconf' && req.method === 'GET': return ok(site.wlans);
      case rest === 'stat/health': return ok([{ subsystem: 'wlan', status: 'ok', num_ap: 2, num_adopted: 2, num_disconnected: 1, num_user: 2 }]);
      case rest === 'rest/user': return ok(site.users);
      case rest === 'cmd/devmgr': {
        const d = site.devices.find((x) => x.mac === body.mac);
        if (!d) return send(400, { meta: { rc: 'error', msg: 'api.err.UnknownDevice' }, data: [] });
        if (body.cmd === 'set-locate') d.locating = true;
        if (body.cmd === 'unset-locate') d.locating = false;
        return ok([]);
      }
      case rest === 'cmd/stamgr': {
        if (body.cmd === 'block-sta') site.users.push({ mac: body.mac, blocked: true });
        if (body.cmd === 'unblock-sta') site.users = site.users.filter((u) => u.mac !== body.mac);
        return ok([]);
      }
      case rest.startsWith('rest/wlanconf/') && req.method === 'PUT': {
        const w = site.wlans.find((x) => x._id === rest.split('/')[2]);
        if (!w) return send(400, { meta: { rc: 'error', msg: 'api.err.Invalid' }, data: [] });
        w.enabled = body.enabled;
        return ok([w]);
      }
    }
    send(404, {});
  }
}
