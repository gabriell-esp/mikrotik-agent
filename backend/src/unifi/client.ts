import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { normalizeFingerprint } from '../routeros/net.js';

export type UnifiErrorKind = 'unreachable' | 'refused' | 'tls' | 'auth' | 'timeout' | 'command' | 'protocol';

export class UnifiError extends Error {
  constructor(public readonly kind: UnifiErrorKind, message: string) {
    super(message);
  }
}

export type UnifiPlatform = 'unifios' | 'legacy';

export interface UnifiOptions {
  url: string;
  username: string;
  password: string;
  tlsFingerprint?: string | null;
  /** Plataforma já detectada (evita tentar as duas a cada login). */
  platform?: UnifiPlatform | null;
  timeoutMs?: number;
}

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: any;
}

export const NET_ERRORS: Record<string, [UnifiErrorKind, string]> = {
  ECONNREFUSED: ['refused', 'Conexão recusada (serviço desativado ou porta errada).'],
  EHOSTUNREACH: ['unreachable', 'Controladora inalcançável pela rede.'],
  ENETUNREACH: ['unreachable', 'Controladora inalcançável pela rede.'],
  ETIMEDOUT: ['unreachable', 'Sem resposta da controladora.'],
  ENOTFOUND: ['unreachable', 'Endereço da controladora não encontrado.'],
  EAI_AGAIN: ['unreachable', 'Endereço da controladora não encontrado.'],
  ECONNRESET: ['tls', 'Conexão encerrada pela controladora (verifique se é HTTPS e a porta).'],
};

/**
 * Cliente da API do UniFi Network Application.
 *  - UniFi OS (Cloud Key Gen2/Gen2+, UDM): login em /api/auth/login, rotas em /proxy/network/...
 *  - Controlador antigo (porta 8443): login em /api/login, rotas direto em /api/...
 * A sessão (cookie + CSRF) é reaproveitada e renovada automaticamente quando expira.
 */
export class UnifiClient {
  platform: UnifiPlatform | null;
  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  private base: URL;
  private agent: http.Agent;
  private checked = new WeakSet<object>();
  version: string | null = null;

  constructor(private readonly opts: UnifiOptions) {
    this.base = new URL(opts.url.replace(/\/+$/, ''));
    this.platform = opts.platform ?? null;
    this.agent = this.base.protocol === 'https:'
      ? new https.Agent({ keepAlive: true, maxSockets: 2, rejectUnauthorized: false })
      : new http.Agent({ keepAlive: true, maxSockets: 2 });
  }

  get loggedIn(): boolean {
    return this.cookies.size > 0;
  }

  close(): void {
    this.agent.destroy();
  }

  private request(method: string, path: string, body?: unknown): Promise<Resp> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const lib = this.base.protocol === 'https:' ? https : http;
    const timeoutMs = this.opts.timeoutMs ?? 15000;
    return new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = { Accept: 'application/json' };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
      }
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
      const req = lib.request(
        { protocol: this.base.protocol, hostname: this.base.hostname, port: this.base.port || undefined, path: this.base.pathname.replace(/\/$/, '') + path, method, agent: this.agent, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            clearTimeout(timer);
            for (const c of res.headers['set-cookie'] ?? []) {
              const [pair] = c.split(';');
              const i = pair.indexOf('=');
              if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
            }
            const csrf = res.headers['x-updated-csrf-token'] ?? res.headers['x-csrf-token'];
            if (typeof csrf === 'string' && csrf) this.csrf = csrf;
            const text = Buffer.concat(chunks).toString('utf8');
            let json: any;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
          });
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        reject(new UnifiError('timeout', `A controladora não respondeu em ${timeoutMs / 1000} s.`));
      }, timeoutMs);
      req.on('socket', (sock) => {
        if (!this.opts.tlsFingerprint || this.checked.has(sock)) return;
        this.checked.add(sock);
        sock.once('secureConnect', () => {
          const fp = (sock as TLSSocket).getPeerCertificate()?.fingerprint256;
          if (!fp || normalizeFingerprint(fp) !== normalizeFingerprint(this.opts.tlsFingerprint!)) {
            req.destroy(new UnifiError('tls', 'Fingerprint do certificado da controladora não confere com o cadastrado.'));
          }
        });
      });
      req.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err instanceof UnifiError) return reject(err);
        const known = NET_ERRORS[err.code ?? ''];
        if (known) return reject(new UnifiError(known[0], known[1]));
        if (/ssl|tls|certificate|EPROTO/i.test(`${err.code} ${err.message}`)) {
          return reject(new UnifiError('tls', `Falha TLS: ${err.message}. Confira se o endereço usa https e a porta correta.`));
        }
        reject(new UnifiError('protocol', err.message));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  private authError(r: Resp): UnifiError {
    const msg = String(r.json?.message ?? r.json?.meta?.msg ?? r.json?.errors?.[0] ?? '');
    if (r.status === 499 || /mfa|2fa|two.?factor/i.test(msg)) {
      return new UnifiError('auth', 'A conta exige verificação em duas etapas. Use um usuário local da controladora, sem MFA.');
    }
    if (r.status === 429) return new UnifiError('auth', 'Muitas tentativas de login; a controladora bloqueou temporariamente. Aguarde alguns minutos.');
    return new UnifiError('auth', 'Usuário ou senha recusados pela controladora.');
  }

  /** Faz login, detectando UniFi OS ou controlador antigo. */
  async login(): Promise<void> {
    this.cookies.clear();
    this.csrf = null;
    const creds = { username: this.opts.username, password: this.opts.password };
    const tryOs = async (): Promise<boolean> => {
      const r = await this.request('POST', '/api/auth/login', { ...creds, rememberMe: true });
      if (r.status === 200 && this.cookies.size) {
        this.platform = 'unifios';
        return true;
      }
      if (r.status === 401 || r.status === 403 || r.status === 429 || r.status === 499) throw this.authError(r);
      return false; // 404/405/HTML: não é UniFi OS
    };
    const tryLegacy = async (): Promise<boolean> => {
      const r = await this.request('POST', '/api/login', creds);
      if (r.status === 200 && r.json?.meta?.rc === 'ok') {
        this.platform = 'legacy';
        this.csrf = this.cookies.get('csrf_token') ?? this.csrf;
        return true;
      }
      if (r.json?.meta?.rc === 'error' || r.status === 400 || r.status === 401) throw this.authError(r);
      return false;
    };
    const order = this.platform === 'legacy' ? [tryLegacy, tryOs] : [tryOs, tryLegacy];
    for (const attempt of order) if (await attempt()) return;
    throw new UnifiError('protocol', 'O endereço não respondeu como uma controladora UniFi. Confira a URL e a porta (UniFi OS: 443; controlador antigo: 8443).');
  }

  private path(p: string): string {
    return this.platform === 'unifios' ? `/proxy/network${p}` : p;
  }

  /** Chamada à API do Network Application, com relogin automático se a sessão expirar. */
  async api<T = any>(method: string, p: string, body?: unknown): Promise<T> {
    if (!this.loggedIn) await this.login();
    let r = await this.request(method, this.path(p), body);
    if (r.status === 401 || r.json?.meta?.msg === 'api.err.LoginRequired') {
      await this.login();
      r = await this.request(method, this.path(p), body);
    }
    if (r.json === undefined) throw new UnifiError('protocol', `Resposta inesperada da controladora (HTTP ${r.status}).`);
    if (r.status >= 400 || r.json?.meta?.rc === 'error') {
      const msg = r.json?.meta?.msg ?? r.json?.message ?? `HTTP ${r.status}`;
      throw new UnifiError(r.status === 401 || r.status === 403 ? 'auth' : 'command', translate(String(msg)));
    }
    return (r.json?.data ?? r.json) as T;
  }

  sites() {
    return this.api<any[]>('GET', '/api/self/sites');
  }
  async sysinfo(site: string) {
    const [info] = await this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/stat/sysinfo`);
    this.version = info?.version ?? null;
    return info;
  }
  devices(site: string) {
    return this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/stat/device`);
  }
  clients(site: string) {
    return this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/stat/sta`);
  }
  knownClients(site: string) {
    return this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/rest/user`);
  }
  wlans(site: string) {
    return this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/rest/wlanconf`);
  }
  health(site: string) {
    return this.api<any[]>('GET', `/api/s/${encodeURIComponent(site)}/stat/health`);
  }
  deviceCmd(site: string, cmd: 'restart' | 'set-locate' | 'unset-locate' | 'upgrade', mac: string) {
    return this.api('POST', `/api/s/${encodeURIComponent(site)}/cmd/devmgr`, { cmd, mac, ...(cmd === 'restart' ? { reboot_type: 'soft' } : {}) });
  }
  clientCmd(site: string, cmd: 'kick-sta' | 'block-sta' | 'unblock-sta', mac: string) {
    return this.api('POST', `/api/s/${encodeURIComponent(site)}/cmd/stamgr`, { cmd, mac });
  }
  setWlanEnabled(site: string, id: string, enabled: boolean) {
    return this.api('PUT', `/api/s/${encodeURIComponent(site)}/rest/wlanconf/${encodeURIComponent(id)}`, { enabled });
  }
}

function translate(msg: string): string {
  const map: Record<string, string> = {
    'api.err.NoSiteContext': 'Site não encontrado na controladora.',
    'api.err.UnknownDevice': 'Dispositivo não encontrado (pode ter sido removido ou trocado).',
    'api.err.UnknownStation': 'Cliente não encontrado (já desconectado?).',
    'api.err.NoPermission': 'O usuário da controladora não tem permissão para esta ação.',
    'api.err.Invalid': 'Requisição recusada pela controladora.',
  };
  return map[msg] ?? msg;
}
