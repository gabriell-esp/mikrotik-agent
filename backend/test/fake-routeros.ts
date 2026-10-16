/**
 * Servidor de TESTE que implementa o protocolo da API RouterOS (porta 8728) em memória.
 * Serve apenas para validar o cliente e os fluxos do sistema; não substitui testes em equipamento real.
 */
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import { encodeSentence, SentenceParser } from '../src/routeros/protocol.js';

type Rec = Record<string, string>;

export interface FakeOptions {
  username?: string;
  password?: string;
  /** "challenge" simula RouterOS anterior ao 6.43. */
  loginMode?: 'modern' | 'challenge';
  data?: Record<string, Rec[]>;
}

export class FakeRouterOS {
  server: net.Server;
  port = 0;
  data: Record<string, Rec[]>;
  commands: string[] = [];
  private nextId = 0x100;

  constructor(private opts: FakeOptions = {}) {
    this.data = structuredClone(opts.data ?? {});
    for (const rows of Object.values(this.data)) for (const r of rows) if (!r['.id']) r['.id'] = this.newId();
    this.server = net.createServer((s) => this.handle(s));
  }

  private newId() {
    return '*' + (this.nextId++).toString(16).toUpperCase();
  }

  async start(): Promise<number> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop() {
    await new Promise((r) => this.server.close(r));
  }

  private handle(sock: net.Socket) {
    const parser = new SentenceParser();
    let authed = false;
    let challenge = '';
    const send = (...sentences: string[][]) => sock.write(Buffer.concat(sentences.map(encodeSentence)));
    const trap = (msg: string) => send(['!trap', `=message=${msg}`], ['!done']);
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      for (const words of parser.push(chunk)) {
        const [cmd, ...rest] = words;
        const attrs: Rec = {};
        const where: Rec = {};
        for (const w of rest) {
          if (w.startsWith('=')) {
            const i = w.indexOf('=', 1);
            attrs[w.slice(1, i)] = w.slice(i + 1);
          } else if (w.startsWith('?')) {
            const i = w.indexOf('=', 1);
            where[w.slice(1, i)] = w.slice(i + 1);
          }
        }
        this.commands.push(cmd);
        if (cmd === '/login') {
          const user = this.opts.username ?? 'api';
          const pass = this.opts.password ?? 'secret';
          if (this.opts.loginMode === 'challenge') {
            if (!attrs.response) {
              challenge = randomBytes(16).toString('hex');
              send(['!done', `=ret=${challenge}`]);
              continue;
            }
            const expected = '00' + createHash('md5').update(Buffer.concat([Buffer.from([0]), Buffer.from(pass), Buffer.from(challenge, 'hex')])).digest('hex');
            if (attrs.name === user && attrs.response === expected) {
              authed = true;
              send(['!done']);
            } else trap('cannot log in');
            continue;
          }
          if (attrs.name === user && attrs.password === pass) {
            authed = true;
            send(['!done']);
          } else trap('invalid user name or password (6)');
          continue;
        }
        if (!authed) {
          trap('not logged in');
          continue;
        }
        const slash = cmd.lastIndexOf('/');
        const path = cmd.slice(0, slash);
        const action = cmd.slice(slash + 1);
        if (path === '/interface' && action === 'monitor-traffic') {
          send(...attrs.interface.split(',').map((n) => ['!re', `=name=${n}`, '=rx-bits-per-second=1000', '=tx-bits-per-second=2000']), ['!done']);
          continue;
        }
        const rows = this.data[path];
        if (!rows) {
          trap('no such command prefix');
          continue;
        }
        if (action === 'print') {
          const match = rows.filter((r) => Object.entries(where).every(([k, v]) => (r[k] ?? '') === v));
          send(...match.map((r) => ['!re', ...Object.entries(r).map(([k, v]) => `=${k}=${v}`)]), ['!done']);
        } else if (action === 'add') {
          if (path === '/ppp/secret' && rows.some((r) => r.name === attrs.name)) {
            trap('failure: secret with the same name already exists');
            continue;
          }
          const id = this.newId();
          rows.push({ '.id': id, disabled: 'false', ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, k === 'disabled' ? String(v === 'yes') : v])) });
          send(['!done', `=ret=${id}`]);
        } else if (action === 'set' || action === 'unset' || action === 'remove') {
          const idx = rows.findIndex((r) => r['.id'] === attrs['.id']);
          if (idx === -1) {
            trap('no such item');
            continue;
          }
          if (action === 'remove') rows.splice(idx, 1);
          else if (action === 'unset') delete rows[idx][attrs['value-name']];
          else {
            for (const [k, v] of Object.entries(attrs)) {
              if (k === '.id') continue;
              rows[idx][k] = k === 'disabled' ? String(v === 'yes' || v === 'true') : v;
            }
          }
          send(['!done']);
        } else trap('no such command');
      }
    });
  }
}

export function sampleRouter(): Record<string, Rec[]> {
  return {
    '/system/resource': [{ version: '7.16.1 (stable)', 'board-name': 'hAP ac2', 'cpu-load': '7', uptime: '1w2d3h4m5s',
      'free-memory': '100000000', 'total-memory': '134217728', 'free-hdd-space': '8000000', 'total-hdd-space': '16777216', 'architecture-name': 'arm' }],
    '/system/identity': [{ name: 'CLIENTE-A-RB' }],
    '/system/clock': [{ time: '10:00:00', date: '2026-10-14', 'gmt-offset': '-03:00' }],
    '/system/routerboard': [{ routerboard: 'true', model: 'RBD52G-5HacD2HnD' }],
    '/system/package': [{ name: 'routeros', version: '7.16.1' }],
    '/system/license': [{ level: '4' }],
    '/system/health': [],
    '/disk': [],
    '/interface': [
      { name: 'ether1', type: 'ether', running: 'true', disabled: 'false', 'rx-byte': '1000', 'tx-byte': '2000' },
      { name: 'wg-slot1', type: 'wg', running: 'true', disabled: 'false' },
    ],
    '/log': [
      { time: '2026-10-13 23:00:00', topics: 'system,info', message: 'router rebooted' },
      { time: '09:59:00', topics: 'pppoe,ppp,info', message: 'joao: authenticated' },
      { time: '09:59:30', topics: 'system,error,critical', message: 'login failure for user admin' },
    ],
    '/ppp/secret': [
      { name: 'joao', password: 'SenhaJoao1', service: 'pppoe', profile: 'plano-50', 'remote-address': '10.0.0.10', comment: 'Rua A, 10', disabled: 'false' },
      { name: 'maria', password: 'SenhaMaria2', service: 'pppoe', profile: 'plano-100', comment: 'Cliente VIP', disabled: 'true' },
    ],
    '/ppp/profile': [
      { name: 'default', default: 'true' },
      { name: 'plano-50', 'rate-limit': '25M/50M', 'local-address': '10.0.0.1' },
      { name: 'plano-100', 'rate-limit': '50M/100M', 'local-address': '10.0.0.1' },
    ],
    '/ppp/active': [{ name: 'joao', service: 'pppoe', address: '10.0.0.10', 'caller-id': 'AA:BB:CC:DD:EE:01', uptime: '2h3m' }],
    '/interface/pppoe-server/server': [{ 'service-name': 'pppoe', interface: 'ether2', disabled: 'false' }],
    '/interface/wireguard': [{ name: 'wg-slot1', 'listen-port': '13231', 'private-key': 'PRIVADA-NAO-DEVE-SAIR', 'public-key': 'PUBA=' }],
    '/interface/wireguard/peers': [
      { interface: 'wg-slot1', 'public-key': 'PEER1KEY=', 'allowed-address': '10.200.0.2/32,192.168.10.0/24', comment: 'Cliente A',
        'current-endpoint-address': '177.10.10.10', 'current-endpoint-port': '51820', 'last-handshake': '1m10s', rx: '123456', tx: '654321', disabled: 'false',
        'preshared-key': 'PSK-NAO-DEVE-SAIR' },
      { interface: 'wg-slot1', 'public-key': 'PEER2KEY=', 'allowed-address': '10.200.0.3/32', comment: 'Cliente B', rx: '0', tx: '0', disabled: 'false' },
    ],
  };
}
