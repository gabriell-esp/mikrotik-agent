import type { TLSSocket } from 'node:tls';
import { RosError, type RosMethod } from './types.js';

/**
 * Cifras aceitas nas conexões TLS com roteadores. Inclui as anônimas (ADH) usadas pelo
 * api-ssl quando não há certificado instalado no RouterOS — o tráfego continua cifrado,
 * mas sem autenticação do servidor; para isso use certificado + fingerprint.
 */
export const ROS_TLS_CIPHERS =
  'DEFAULT:ADH-AES256-GCM-SHA384:ADH-AES128-GCM-SHA256:ADH-AES256-SHA256:ADH-AES128-SHA256:ADH-AES256-SHA:ADH-AES128-SHA:@SECLEVEL=0';

export function normalizeFingerprint(fp: string): string {
  return fp.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

export function checkFingerprint(socket: TLSSocket, expected: string | null | undefined, method: RosMethod): void {
  if (!expected) return;
  const cert = socket.getPeerCertificate();
  const actual = cert?.fingerprint256 ? normalizeFingerprint(cert.fingerprint256) : '';
  if (!actual) throw new RosError('tls', 'O roteador não apresentou certificado, mas há fingerprint configurado.', method);
  if (actual !== normalizeFingerprint(expected)) {
    throw new RosError('tls', 'Fingerprint do certificado não confere com o cadastrado.', method);
  }
}

/** Converte erros de rede do Node em categorias compreensíveis. */
export function classifyNetError(err: NodeJS.ErrnoException, method: RosMethod, port: number): RosError {
  if (err instanceof RosError) return err;
  const code = err.code ?? '';
  switch (code) {
    case 'ECONNREFUSED':
      return new RosError('refused', `Conexão recusada na porta ${port} (serviço desabilitado ou bloqueado).`, method);
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new RosError('unreachable', `Equipamento inacessível (${code}).`, method);
    case 'ECONNRESET':
    case 'EPIPE':
      return new RosError('tls', `Conexão encerrada pelo roteador durante a negociação (porta ${port}). Verifique certificado/serviço.`, method);
  }
  if (code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS') || /ssl|tls|handshake|certificate/i.test(err.message)) {
    return new RosError('tls', `Falha TLS: ${err.message}`, method);
  }
  return new RosError('protocol', err.message, method);
}
