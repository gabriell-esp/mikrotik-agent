/**
 * Servidor de TESTE que imita os endpoints usados do WPPConnect Server. Somente para testes automatizados.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export class FakeWppConnect {
  server: http.Server;
  url = '';
  secret = 'SEGREDO-TESTE';
  token = 'tok-1';
  connected = false;
  failSends = 0;
  sent: { phone: string; isGroup: boolean; message: string }[] = [];
  tokensIssued = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => this.handle(req, res, body ? JSON.parse(body) : {}));
    });
  }

  async start(port = 0) {
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const parts = (req.url ?? '').split('/').filter(Boolean); // api, session, ...
    if (parts[2] && parts[3] === 'generate-token') {
      if (decodeURIComponent(parts[2]) !== this.secret) return send(400, { message: 'secret inválido' });
      this.tokensIssued++;
      return send(201, { status: 'success', session: parts[1], token: this.token, full: `${parts[1]}:${this.token}` });
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) return send(401, { message: 'Unauthorized' });
    const action = parts[2];
    switch (action) {
      case 'status-session':
        return send(200, this.connected ? { status: 'CONNECTED', qrcode: null } : { status: 'QRCODE', qrcode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' });
      case 'check-connection-session':
        return send(200, { status: this.connected, message: this.connected ? 'Connected' : 'Disconnected' });
      case 'start-session':
        return send(200, { status: 'INITIALIZING' });
      case 'logout-session':
        this.connected = false;
        return send(200, { status: true });
      case 'all-groups':
        return send(200, { status: 'success', response: [{ id: { _serialized: '120363000000000001@g.us' }, name: 'NOC Slot1' }] });
      case 'send-message':
        if (!this.connected) return send(400, { status: 'error', message: 'Sessão desconectada' });
        if (this.failSends > 0) {
          this.failSends--;
          return send(500, { status: 'error', message: 'falha temporária' });
        }
        this.sent.push(body);
        return send(201, { status: 'success', response: [{ id: 'msg' }] });
    }
    send(404, { message: 'not found' });
  }
}
