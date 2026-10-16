export type RosRecord = Record<string, string>;
export type RosMethod = 'api-ssl' | 'rest' | 'api';

export interface PrintOptions {
  proplist?: string[];
  /** Filtro de igualdade aplicado no próprio roteador. */
  where?: Record<string, string>;
}

/**
 * Interface comum aos transportes (API binária e REST). Os caminhos usam o formato do
 * terminal com barras, ex.: "/ppp/secret". Valores trafegam como texto, como no RouterOS.
 */
export interface RosClient {
  readonly method: RosMethod;
  print(path: string, opts?: PrintOptions): Promise<RosRecord[]>;
  add(path: string, values: Record<string, string>): Promise<string>;
  set(path: string, id: string, values: Record<string, string>): Promise<void>;
  remove(path: string, id: string): Promise<void>;
  /** Executa um comando arbitrário (ex.: "/ppp/active", "remove", {...}). */
  command(path: string, cmd: string, params?: Record<string, string>): Promise<RosRecord[]>;
  close(): void;
}

export type RosErrorKind =
  | 'unreachable' // sem resposta / timeout de conexão / rota inexistente
  | 'refused'     // porta fechada ou serviço desabilitado
  | 'tls'         // falha de negociação TLS ou fingerprint divergente
  | 'auth'        // usuário/senha recusados
  | 'permission'  // usuário sem política suficiente no RouterOS
  | 'timeout'     // conectado, mas comando sem resposta no prazo
  | 'unsupported' // comando/menu inexistente nesta versão ou pacote
  | 'command'     // erro retornado pelo RouterOS ao executar
  | 'protocol'    // resposta inesperada
  | 'config';     // problema local (ex.: senha cifrada com outra chave mestra)

export class RosError extends Error {
  constructor(public readonly kind: RosErrorKind, message: string, public readonly method?: RosMethod) {
    super(message);
  }
}

export interface DeviceConnInfo {
  id: number;
  name: string;
  host: string;
  username: string;
  password: string;
  api_method: 'auto' | RosMethod;
  api_ssl_port: number;
  rest_port: number;
  api_port: number;
  allow_plaintext: boolean;
  tls_fingerprint: string | null;
  detected_method: string | null;
}

export interface TransportOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  tlsFingerprint?: string | null;
}
