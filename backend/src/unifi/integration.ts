import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { normalizeFingerprint } from '../routeros/net.js';
import { NET_ERRORS, UnifiError, type UnifiPlatform } from './client.js';

export interface IntegrationOptions {
  url: string;
  apiKey: string;
  tlsFingerprint?: string | null;
  platform?: UnifiPlatform | null;
  timeoutMs?: number;
}

/** Prefixos da Integration API: console UniFi OS e Network Application instalado em servidor. */
const PREFIXES: Record<UnifiPlatform, string> = { unifios: '/proxy/network/integration', legacy: '/integration' };

/**
 * Cliente da UniFi Network Integration API oficial (autenticação por API key, cabeçalho X-API-KEY).
 * Disponível a partir do Network 9.x; redes Wi-Fi (wifi/broadcasts) a partir do 10.x.
 */
export class UnifiIntegrationClient {
  readonly mode = 'apikey' as const;
  platform: UnifiPlatform | null;
  version: string | null = null;
  private base: URL;
  private agent: http.Agent;
  private checked = new WeakSet<object>();

  constructor(private readonly opts: IntegrationOptions) {
    this.base = new URL(opts.url.replace(/\/+$/, ''));
    this.platform = opts.platform ?? null;
    this.agent = this.base.protocol === 'https:'
      ? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false })
      : new http.Agent({ keepAlive: true, maxSockets: 4 });
  }

  close(): void {
    this.agent.destroy();
  }

  private request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const lib = this.base.protocol === 'https:' ? https : http;
    const timeoutMs = this.opts.timeoutMs ?? 15000;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          protocol: this.base.protocol, hostname: this.base.hostname, port: this.base.port || undefined,
          path: this.base.pathname.replace(/\/$/, '') + path, method, agent: this.agent,
          headers: {
            Accept: 'application/json',
            'X-API-KEY': this.opts.apiKey,
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString('utf8');
            let json: any;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode ?? 0, json });
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

  /** Descobre o prefixo da API e valida a chave. */
  async detect(): Promise<void> {
    const order: UnifiPlatform[] = this.platform === 'legacy' ? ['legacy', 'unifios'] : ['unifios', 'legacy'];
    for (const p of order) {
      const r = await this.request('GET', `${PREFIXES[p]}/v1/info`);
      if (r.status === 401 || r.status === 403) throw new UnifiError('auth', 'API key recusada pela controladora (inválida, revogada ou sem permissão).');
      if (r.status === 200 && r.json && typeof r.json === 'object') {
        this.platform = p;
        this.version = r.json.applicationVersion ?? null;
        return;
      }
    }
    throw new UnifiError('protocol', 'A controladora não respondeu à Integration API. A API key exige UniFi Network 9.0 ou superior; confira também a URL e a porta.');
  }

  async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.platform || this.version === null) await this.detect();
    const r = await this.request(method, `${PREFIXES[this.platform!]}${path}`, body);
    if (r.status === 401 || r.status === 403) throw new UnifiError('auth', 'API key recusada pela controladora (inválida, revogada ou sem permissão para esta ação).');
    if (r.status === 404) throw new UnifiError('command', 'Recurso não disponível nesta versão do UniFi Network (ou item inexistente).');
    if (r.status >= 400) {
      const msg = r.json?.message ?? r.json?.error ?? `HTTP ${r.status}`;
      throw new UnifiError('command', `A controladora recusou a operação: ${msg}`);
    }
    if (r.json === undefined) throw new UnifiError('protocol', `Resposta inesperada da controladora (HTTP ${r.status}).`);
    return r.json as T;
  }

  /** Percorre a paginação (offset/limit) das listas. */
  async list<T = any>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 10000; ) {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.api<{ data: T[]; count: number; totalCount: number }>('GET', `${path}${sep}offset=${offset}&limit=200`);
      out.push(...(page.data ?? []));
      offset += page.count ?? page.data?.length ?? 0;
      if (!page.count || offset >= (page.totalCount ?? 0)) break;
    }
    return out;
  }

  async info() {
    await this.detect();
    return { version: this.version };
  }
  sites() {
    return this.list<{ id: string; internalReference?: string; name: string }>('/v1/sites');
  }
  devices(site: string) {
    return this.list(`/v1/sites/${encodeURIComponent(site)}/devices`);
  }
  device(site: string, id: string) {
    return this.api('GET', `/v1/sites/${encodeURIComponent(site)}/devices/${encodeURIComponent(id)}`);
  }
  deviceStats(site: string, id: string) {
    return this.api('GET', `/v1/sites/${encodeURIComponent(site)}/devices/${encodeURIComponent(id)}/statistics/latest`);
  }
  clients(site: string) {
    return this.list(`/v1/sites/${encodeURIComponent(site)}/clients`);
  }
  wifiBroadcasts(site: string) {
    return this.list(`/v1/sites/${encodeURIComponent(site)}/wifi/broadcasts`);
  }
  wifiBroadcast(site: string, id: string) {
    return this.api('GET', `/v1/sites/${encodeURIComponent(site)}/wifi/broadcasts/${encodeURIComponent(id)}`);
  }
  updateWifiBroadcast(site: string, id: string, body: unknown) {
    return this.api('PUT', `/v1/sites/${encodeURIComponent(site)}/wifi/broadcasts/${encodeURIComponent(id)}`, body);
  }
  restartDevice(site: string, id: string) {
    return this.api('POST', `/v1/sites/${encodeURIComponent(site)}/devices/${encodeURIComponent(id)}/actions`, { action: 'RESTART' });
  }
}
