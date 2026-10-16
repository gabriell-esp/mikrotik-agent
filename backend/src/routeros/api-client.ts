import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { checkFingerprint, classifyNetError, ROS_TLS_CIPHERS } from './net.js';
import { encodeSentence, parseSentence, SentenceParser, type Reply } from './protocol.js';
import { RosError, type PrintOptions, type RosClient, type RosMethod, type RosRecord, type TransportOptions } from './types.js';

export function classifyTrap(message: string, method: RosMethod): RosError {
  if (/no such command|no such item|unknown command/i.test(message)) return new RosError('unsupported', message, method);
  if (/not enough permissions|permission denied/i.test(message)) {
    return new RosError('permission', `O usuário do roteador não tem permissão: ${message}`, method);
  }
  return new RosError('command', message, method);
}

/** Cliente da API binária do RouterOS (v6 e v7), com ou sem TLS. */
export class ApiClient implements RosClient {
  private parser = new SentenceParser();
  private pending: { replies: Reply[]; resolve: (r: Reply[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private fatal: RosError | null = null;

  private constructor(
    private readonly socket: net.Socket,
    readonly method: RosMethod,
    private readonly opts: TransportOptions,
  ) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (err) => this.fail(classifyNetError(err, method, opts.port)));
    socket.on('close', () => this.fail(new RosError('protocol', 'Conexão encerrada pelo roteador.', method)));
  }

  static async connect(opts: TransportOptions, useTls: boolean): Promise<ApiClient> {
    const method: RosMethod = useTls ? 'api-ssl' : 'api';
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      let tcpUp = false;
      const timer = setTimeout(() => {
        s.destroy();
        reject(
          tcpUp
            ? new RosError('tls', `TCP conectado na porta ${opts.port}, mas a negociação TLS não foi concluída.`, method)
            : new RosError('unreachable', `Sem resposta em ${opts.connectTimeoutMs} ms na porta ${opts.port}.`, method),
        );
      }, opts.connectTimeoutMs);
      const onErr = (err: Error) => {
        clearTimeout(timer);
        reject(classifyNetError(err, method, opts.port));
      };
      const s: net.Socket = useTls
        ? tls.connect(
            { host: opts.host, port: opts.port, rejectUnauthorized: false, ciphers: ROS_TLS_CIPHERS, minVersion: 'TLSv1' },
            () => {
              clearTimeout(timer);
              try {
                checkFingerprint(s as tls.TLSSocket, opts.tlsFingerprint, method);
                resolve(s);
              } catch (e) {
                s.destroy();
                reject(e);
              }
            },
          )
        : net.connect({ host: opts.host, port: opts.port }, () => {
            clearTimeout(timer);
            resolve(s);
          });
      s.once('error', onErr);
      s.once('connect', () => (tcpUp = true));
    });
    socket.setNoDelay(true);
    const client = new ApiClient(socket, method, opts);
    try {
      await client.login();
    } catch (e) {
      client.close();
      throw e;
    }
    return client;
  }

  private async login(): Promise<void> {
    const { username, password } = this.opts;
    let replies: Reply[];
    try {
      replies = await this.talk(['/login', `=name=${username}`, `=password=${password}`]);
    } catch (e) {
      throw this.loginError(e);
    }
    const ret = replies.find((r) => r.type === '!done')?.attrs.ret;
    if (ret) {
      // RouterOS anterior ao 6.43: autenticação por desafio MD5.
      const hash = createHash('md5')
        .update(Buffer.concat([Buffer.from([0]), Buffer.from(password, 'latin1'), Buffer.from(ret, 'hex')]))
        .digest('hex');
      try {
        await this.talk(['/login', `=name=${username}`, `=response=00${hash}`]);
      } catch (e) {
        throw this.loginError(e);
      }
    }
  }

  private loginError(e: unknown): RosError {
    if (e instanceof RosError && (e.kind === 'command' || e.kind === 'permission' || e.kind === 'unsupported')) {
      return new RosError('auth', `Autenticação recusada: ${e.message}`, this.method);
    }
    return e as RosError;
  }

  private onData(chunk: Buffer): void {
    let sentences: string[][];
    try {
      sentences = this.parser.push(chunk);
    } catch (e) {
      this.fail(new RosError('protocol', (e as Error).message, this.method));
      return;
    }
    for (const words of sentences) {
      const reply = parseSentence(words);
      if (reply.type === '!fatal') {
        this.fail(new RosError('protocol', `Erro fatal do roteador: ${reply.attrs.message ?? ''}`, this.method));
        return;
      }
      if (!this.pending) continue;
      this.pending.replies.push(reply);
      if (reply.type === '!done') {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(p.replies);
      }
    }
  }

  private fail(err: RosError): void {
    if (!this.fatal) this.fatal = err;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.close();
  }

  /** Envia uma sentença e aguarda o !done. Comandos são serializados na mesma conexão. */
  talk(words: string[]): Promise<Reply[]> {
    const run = () =>
      new Promise<Reply[]>((resolve, reject) => {
        if (this.fatal) return reject(this.fatal);
        if (this.closed) return reject(new RosError('protocol', 'Conexão já encerrada.', this.method));
        const timer = setTimeout(() => {
          this.fail(new RosError('timeout', `O roteador não respondeu em ${this.opts.commandTimeoutMs} ms (${words[0]}).`, this.method));
        }, this.opts.commandTimeoutMs);
        this.pending = { replies: [], resolve, reject, timer };
        this.socket.write(encodeSentence(words));
      }).then((replies) => {
        const trap = replies.find((r) => r.type === '!trap');
        if (trap) throw classifyTrap(trap.attrs.message ?? 'Erro desconhecido', this.method);
        return replies;
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private static records(replies: Reply[]): RosRecord[] {
    return replies.filter((r) => r.type === '!re').map((r) => r.attrs);
  }

  async print(path: string, opts: PrintOptions = {}): Promise<RosRecord[]> {
    const words = [`${path}/print`];
    if (opts.proplist?.length) words.push(`=.proplist=${opts.proplist.join(',')}`);
    for (const [k, v] of Object.entries(opts.where ?? {})) words.push(`?${k}=${v}`);
    return ApiClient.records(await this.talk(words));
  }

  async add(path: string, values: Record<string, string>): Promise<string> {
    const replies = await this.talk([`${path}/add`, ...Object.entries(values).map(([k, v]) => `=${k}=${v}`)]);
    return replies.find((r) => r.type === '!done')?.attrs.ret ?? '';
  }

  async set(path: string, id: string, values: Record<string, string>): Promise<void> {
    await this.talk([`${path}/set`, `=.id=${id}`, ...Object.entries(values).map(([k, v]) => `=${k}=${v}`)]);
  }

  async remove(path: string, id: string): Promise<void> {
    await this.talk([`${path}/remove`, `=.id=${id}`]);
  }

  async command(path: string, cmd: string, params: Record<string, string> = {}): Promise<RosRecord[]> {
    const replies = await this.talk([`${path}/${cmd}`, ...Object.entries(params).map(([k, v]) => `=${k}=${v}`)]);
    const done = replies.find((r) => r.type === '!done');
    const recs = ApiClient.records(replies);
    return recs.length ? recs : done && Object.keys(done.attrs).length ? [done.attrs] : [];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
  }
}
