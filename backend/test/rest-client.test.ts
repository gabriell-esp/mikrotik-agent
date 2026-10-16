/**
 * Valida o cliente REST contra um servidor HTTPS de TESTE (certificado autoassinado gerado na hora),
 * incluindo fingerprint e mapeamento de erros. Ignorado se não houver openssl no PATH.
 */
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RestClient } from '../src/routeros/rest-client.js';
import { RosError } from '../src/routeros/types.js';

let hasOpenssl = true;
try {
  execFileSync('openssl', ['version']);
} catch {
  hasOpenssl = false;
}

describe.skipIf(!hasOpenssl)('cliente REST', () => {
  let server: https.Server;
  let port = 0;
  let fingerprint = '';
  const secrets: Record<string, string>[] = [{ '.id': '*1', name: 'joao', password: 'x', disabled: 'false' }];

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rest-test-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=router'], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'c.pem'));
    fingerprint = new X509Certificate(cert).fingerprint256;
    server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert }, (req, res) => {
      const auth = Buffer.from(String(req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (auth !== 'api:secret') return send(401, { error: 401, message: 'Unauthorized' });
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = new URL(req.url!, 'https://x');
        if (url.pathname === '/rest/system/identity') return send(200, { name: 'RB-REST' });
        if (url.pathname === '/rest/system/resource') return send(200, { version: '7.16', 'cpu-load': '3' });
        if (url.pathname === '/rest/ppp/secret' && req.method === 'GET') {
          const name = url.searchParams.get('name');
          return send(200, secrets.filter((s) => !name || s.name === name));
        }
        if (url.pathname === '/rest/ppp/secret' && req.method === 'PUT') {
          const v = JSON.parse(body);
          if (secrets.some((s) => s.name === v.name)) return send(400, { error: 400, message: 'Bad Request', detail: 'failure: secret with the same name already exists' });
          const rec = { '.id': `*${secrets.length + 1}`, ...v };
          secrets.push(rec);
          return send(201, rec);
        }
        if (url.pathname.startsWith('/rest/ppp/secret/') && req.method === 'PATCH') {
          const id = decodeURIComponent(url.pathname.split('/').pop()!);
          Object.assign(secrets.find((s) => s['.id'] === id)!, JSON.parse(body));
          return send(200, {});
        }
        send(404, { error: 404, message: 'Not Found', detail: 'no such command or directory' });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as any).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const opts = () => ({ host: '127.0.0.1', port, username: 'api', password: 'secret', connectTimeoutMs: 2000, commandTimeoutMs: 3000 });

  it('conecta, lê objeto único e listas filtradas, cria e altera', async () => {
    const c = await RestClient.connect({ ...opts(), tlsFingerprint: fingerprint });
    expect((await c.print('/system/resource'))[0].version).toBe('7.16');
    expect(await c.print('/ppp/secret', { where: { name: 'joao' } })).toHaveLength(1);
    expect(await c.add('/ppp/secret', { name: 'ana', password: 'p' })).toBe('*2');
    await c.set('/ppp/secret', '*2', { disabled: 'yes' });
    expect(secrets[1].disabled).toBe('yes');
    await expect(c.add('/ppp/secret', { name: 'ana' })).rejects.toMatchObject({ kind: 'command', message: /same name/ });
    await expect(c.print('/routing/bgp/session')).rejects.toMatchObject({ kind: 'unsupported' });
    c.close();
  });

  it('rejeita fingerprint divergente e senha errada', async () => {
    await expect(RestClient.connect({ ...opts(), tlsFingerprint: 'AA'.repeat(32) })).rejects.toBeInstanceOf(RosError);
    await expect(RestClient.connect({ ...opts(), tlsFingerprint: 'AA'.repeat(32) })).rejects.toMatchObject({ kind: 'tls' });
    await expect(RestClient.connect({ ...opts(), password: 'errada' })).rejects.toMatchObject({ kind: 'auth' });
  });
});
