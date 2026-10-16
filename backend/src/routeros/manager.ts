import { config } from '../config.js';
import { Semaphore } from '../lib/semaphore.js';
import { ApiClient } from './api-client.js';
import { RestClient } from './rest-client.js';
import { RosError, type DeviceConnInfo, type RosClient, type RosMethod, type TransportOptions } from './types.js';

const globalLimit = new Semaphore(config.ros.maxConcurrent);
const deviceLimits = new Map<number, Semaphore>();

function deviceLimit(id: number): Semaphore {
  let s = deviceLimits.get(id);
  if (!s) deviceLimits.set(id, (s = new Semaphore(config.ros.perDeviceConcurrent)));
  return s;
}

/** Ordem de tentativa. "auto" prioriza transportes cifrados e o último método que funcionou. */
export function methodOrder(d: Pick<DeviceConnInfo, 'api_method' | 'allow_plaintext' | 'detected_method'>): RosMethod[] {
  if (d.api_method !== 'auto') return [d.api_method];
  const order: RosMethod[] = ['api-ssl', 'rest'];
  if (d.allow_plaintext) order.push('api');
  const last = d.detected_method as RosMethod | null;
  if (last && order.includes(last)) return [last, ...order.filter((m) => m !== last)];
  return order;
}

function transport(d: DeviceConnInfo, method: RosMethod): TransportOptions {
  return {
    host: d.host,
    port: method === 'api-ssl' ? d.api_ssl_port : method === 'rest' ? d.rest_port : d.api_port,
    username: d.username,
    password: d.password,
    connectTimeoutMs: config.ros.connectTimeoutMs,
    commandTimeoutMs: config.ros.commandTimeoutMs,
    tlsFingerprint: d.tls_fingerprint,
  };
}

async function connectMethod(d: DeviceConnInfo, method: RosMethod): Promise<RosClient> {
  const t = transport(d, method);
  if (method === 'api' && !d.allow_plaintext) {
    throw new RosError('refused', 'API sem criptografia (8728) não está liberada para este equipamento.', 'api');
  }
  if (method === 'rest') return RestClient.connect(t);
  return ApiClient.connect(t, method === 'api-ssl');
}

// Ordem de relevância ao reportar a falha final de conexão.
const ERROR_PRIORITY: RosError['kind'][] = ['auth', 'permission', 'tls', 'timeout', 'unsupported', 'protocol', 'refused', 'unreachable'];

export interface ConnectResult {
  client: RosClient;
  method: RosMethod;
  attempts: { method: RosMethod; error: string }[];
}

export async function openClient(d: DeviceConnInfo): Promise<ConnectResult> {
  const errors: RosError[] = [];
  const attempts: ConnectResult['attempts'] = [];
  for (const method of methodOrder(d)) {
    try {
      const client = await connectMethod(d, method);
      return { client, method, attempts };
    } catch (e) {
      const err = e instanceof RosError ? e : new RosError('protocol', (e as Error).message, method);
      errors.push(err);
      attempts.push({ method, error: err.message });
      // Sem rota/sem resposta: as demais portas também não responderão; evita esperar timeouts em série.
      if (err.kind === 'unreachable') break;
    }
  }
  errors.sort((a, b) => ERROR_PRIORITY.indexOf(a.kind) - ERROR_PRIORITY.indexOf(b.kind));
  const main = errors[0] ?? new RosError('protocol', 'Nenhum método de conexão disponível.');
  const detail = attempts.map((a) => `${a.method}: ${a.error}`).join(' | ');
  const err = new RosError(main.kind, attempts.length > 1 ? `${main.message} [tentativas — ${detail}]` : main.message, main.method);
  (err as RosError & { attempts?: unknown }).attempts = attempts;
  throw err;
}

export interface SessionHooks {
  onConnected?: (method: RosMethod) => Promise<void> | void;
  onConnectError?: (err: RosError) => Promise<void> | void;
}

/**
 * Abre uma conexão respeitando os limites global e por equipamento, executa `fn` e fecha.
 * Erros de conexão são repassados aos hooks (atualização de status de gerência).
 */
export async function withRouter<T>(d: DeviceConnInfo, fn: (c: RosClient) => Promise<T>, hooks: SessionHooks = {}): Promise<T> {
  const releaseDevice = await deviceLimit(d.id).acquire();
  const releaseGlobal = await globalLimit.acquire();
  let client: RosClient | undefined;
  try {
    let res: ConnectResult;
    try {
      res = await openClient(d);
    } catch (e) {
      await hooks.onConnectError?.(e as RosError);
      throw e;
    }
    client = res.client;
    await hooks.onConnected?.(res.method);
    return await fn(client);
  } finally {
    client?.close();
    releaseGlobal();
    releaseDevice();
  }
}
