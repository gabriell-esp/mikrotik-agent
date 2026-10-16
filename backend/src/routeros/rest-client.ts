import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { checkFingerprint, classifyNetError, ROS_TLS_CIPHERS } from './net.js';
import { RosError, type PrintOptions, type RosClient, type RosRecord, type TransportOptions } from './types.js';

/** Cliente da API REST (RouterOS v7.1+, serviço www-ssl). */
export class RestClient implements RosClient {
  readonly method = 'rest' as const;
  private agent: https.Agent;
  private auth: string;
  private checked = new WeakSet<object>();

  private constructor(private readonly opts: TransportOptions) {
    this.agent = new https.Agent({
      keepAlive: true,
      maxSockets: 2,
      rejectUnauthorized: false,
      ciphers: ROS_TLS_CIPHERS,
      minVersion: 'TLSv1.2',
    });
    this.auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`, 'utf8').toString('base64');
  }

  static async connect(opts: TransportOptions): Promise<RestClient> {
    const c = new RestClient(opts);
    try {
      // Valida disponibilidade do REST e as credenciais.
      await c.request('GET', '/system/identity', undefined, opts.connectTimeoutMs + 3000);
    } catch (e) {
      c.close();
      throw e;
    }
    return c;
  }

  private request(method: string, path: string, body?: unknown, timeoutMs = this.opts.commandTimeoutMs): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const req = https.request(
        {
          host: this.opts.host,
          port: this.opts.port,
          path: '/rest' + path,
          method,
          agent: this.agent,
          headers: {
            Authorization: this.auth,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', (err) => done(() => reject(classifyNetError(err, 'rest', this.opts.port))));
          res.on('end', () =>
            done(() => {
              const text = Buffer.concat(chunks).toString('utf8');
              const status = res.statusCode ?? 0;
              let json: any;
              try {
                json = text ? JSON.parse(text) : null;
              } catch {
                json = undefined;
              }
              if (status === 401) return reject(new RosError('auth', 'Autenticação recusada pelo REST (usuário/senha ou política "rest-api").', 'rest'));
              if (status === 403) return reject(new RosError('permission', 'O usuário do roteador não tem permissão para esta operação.', 'rest'));
              if (json === undefined) {
                return reject(new RosError('unsupported', `REST indisponível nesta porta (HTTP ${status}, resposta não JSON). Requer RouterOS 7.1+ com www-ssl.`, 'rest'));
              }
              if (status >= 400) {
                const msg = [json?.message, json?.detail].filter(Boolean).join(': ') || `HTTP ${status}`;
                if (status === 404 || /no such command|no such item|unknown/i.test(msg)) return reject(new RosError('unsupported', msg, 'rest'));
                if (/not enough permissions/i.test(msg)) return reject(new RosError('permission', msg, 'rest'));
                return reject(new RosError('command', msg, 'rest'));
              }
              resolve(json);
            }),
          );
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        done(() => reject(new RosError('timeout', `Sem resposta do REST em ${timeoutMs} ms (${path}).`, 'rest')));
      }, timeoutMs);
      req.on('socket', (sock) => {
        if (this.checked.has(sock)) return;
        this.checked.add(sock);
        sock.once('secureConnect', () => {
          try {
            checkFingerprint(sock as TLSSocket, this.opts.tlsFingerprint, 'rest');
          } catch (e) {
            req.destroy(e as Error);
          }
        });
      });
      req.on('error', (err) => done(() => reject(classifyNetError(err, 'rest', this.opts.port))));
      if (payload) req.write(payload);
      req.end();
    });
  }

  private static toRecords(json: unknown): RosRecord[] {
    const stringify = (o: Record<string, unknown>): RosRecord =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    if (Array.isArray(json)) return json.map((o) => stringify(o));
    if (json && typeof json === 'object') return Object.keys(json).length ? [stringify(json as Record<string, unknown>)] : [];
    return [];
  }

  async print(path: string, opts: PrintOptions = {}): Promise<RosRecord[]> {
    const qs = new URLSearchParams();
    if (opts.proplist?.length) qs.set('.proplist', opts.proplist.join(','));
    for (const [k, v] of Object.entries(opts.where ?? {})) qs.set(k, v);
    const q = qs.toString();
    return RestClient.toRecords(await this.request('GET', path + (q ? `?${q}` : '')));
  }

  async add(path: string, values: Record<string, string>): Promise<string> {
    const r = (await this.request('PUT', path, values)) as Record<string, string> | null;
    return r?.['.id'] ?? '';
  }

  async set(path: string, id: string, values: Record<string, string>): Promise<void> {
    await this.request('PATCH', `${path}/${encodeURIComponent(id)}`, values);
  }

  async remove(path: string, id: string): Promise<void> {
    await this.request('DELETE', `${path}/${encodeURIComponent(id)}`);
  }

  async command(path: string, cmd: string, params: Record<string, string> = {}): Promise<RosRecord[]> {
    return RestClient.toRecords(await this.request('POST', `${path}/${cmd}`, params));
  }

  close(): void {
    this.agent.destroy();
  }
}
