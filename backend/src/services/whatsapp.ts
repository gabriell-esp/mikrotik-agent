import { secretBox } from '../lib/secrets.js';
import { getSetting, setSetting } from './settings.js';

/** Configuração da integração com o WPPConnect Server (segredos cifrados com a chave mestra). */
export interface WhatsappSettings {
  enabled: boolean;
  base_url: string;
  session: string;
  secret_key_enc: string | null;
  token_enc: string | null;
  /** Tempo que um novo status precisa se manter antes de notificar (anti-oscilação). */
  delay_sec: number;
  /** Percentual de CPU/memória/armazenamento que dispara alerta de recurso. */
  resource_threshold: number;
}

export const WA_DEFAULTS: WhatsappSettings = {
  enabled: false,
  base_url: 'http://wppconnect:21465',
  session: 'slot1',
  secret_key_enc: null,
  token_enc: null,
  delay_sec: 120,
  resource_threshold: 90,
};

export const getWhatsappSettings = () => getSetting<WhatsappSettings>('whatsapp', WA_DEFAULTS);
export const saveWhatsappSettings = (s: WhatsappSettings) => setSetting('whatsapp', s);

export class WhatsappError extends Error {}

/** Normaliza número brasileiro: só dígitos e DDI 55 quando ausente. */
export function normalizePhone(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** IDs de grupo vêm como "1203...@g.us"; o WPPConnect espera o número do grupo com isGroup=true. */
export function normalizeGroup(v: string): string {
  return v.trim().replace(/@g\.us$/, '');
}

export class WppClient {
  constructor(private s: WhatsappSettings, private readonly timeoutMs = 20000) {}

  get configured(): boolean {
    return !!(this.s.base_url && this.s.session && this.s.secret_key_enc);
  }

  private url(path: string): string {
    return `${this.s.base_url.replace(/\/+$/, '')}/api/${encodeURIComponent(this.s.session)}${path}`;
  }

  private async fetchJson(method: string, url: string, token?: string, body?: unknown): Promise<{ status: number; data: any; raw: Response }> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      throw new WhatsappError(
        err.name === 'TimeoutError' ? 'O servidor WPPConnect não respondeu no prazo.' : `Não foi possível conectar ao WPPConnect (${this.s.base_url}): ${err.message}`,
      );
    }
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    return { status: res.status, data, raw: res };
  }

  /** Gera (ou renova) o token de acesso usando a SECRET_KEY do servidor. */
  async generateToken(): Promise<string> {
    if (!this.configured) throw new WhatsappError('Integração não configurada (URL, sessão e chave secreta).');
    const secret = secretBox().decrypt(this.s.secret_key_enc!);
    const { status, data } = await this.fetchJson('POST', this.url(`/${encodeURIComponent(secret)}/generate-token`));
    if (status >= 400 || !data?.token) {
      throw new WhatsappError(status === 401 || status === 400 ? 'Chave secreta recusada pelo WPPConnect.' : `Falha ao gerar token (HTTP ${status}).`);
    }
    this.s.token_enc = secretBox().encrypt(data.token);
    const cur = await getWhatsappSettings();
    await saveWhatsappSettings({ ...cur, token_enc: this.s.token_enc });
    return data.token;
  }

  /** Requisição autenticada; renova o token automaticamente se ele for recusado. */
  private async call(method: string, path: string, body?: unknown): Promise<any> {
    let token = this.s.token_enc ? secretBox().decrypt(this.s.token_enc) : await this.generateToken();
    let r = await this.fetchJson(method, this.url(path), token, body);
    if (r.status === 401 || r.status === 403) {
      token = await this.generateToken();
      r = await this.fetchJson(method, this.url(path), token, body);
    }
    if (r.status >= 400) {
      const msg = r.data?.message ?? r.data?.error ?? `HTTP ${r.status}`;
      throw new WhatsappError(`WPPConnect: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return r.data;
  }

  /** Estado da sessão: CONNECTED, QRCODE (aguardando leitura), INITIALIZING, CLOSED… e QR em data URL. */
  async status(): Promise<{ status: string; connected: boolean; qrcode: string | null }> {
    const st = await this.call('GET', '/status-session');
    let connected = st?.status === 'CONNECTED' || st?.status === 'inChat';
    if (!connected && st?.status && st.status !== 'CLOSED') {
      const chk = await this.call('GET', '/check-connection-session').catch(() => null);
      connected = chk?.status === true;
    }
    return { status: connected ? 'CONNECTED' : String(st?.status ?? 'CLOSED'), connected, qrcode: connected ? null : st?.qrcode ?? null };
  }

  async start(): Promise<void> {
    await this.call('POST', '/start-session', { waitQrCode: false });
  }

  async logout(): Promise<void> {
    await this.call('POST', '/logout-session');
  }

  async groups(): Promise<{ id: string; name: string }[]> {
    const r = await this.call('GET', '/all-groups');
    const list: any[] = Array.isArray(r?.response) ? r.response : Array.isArray(r) ? r : [];
    return list
      .map((g) => ({
        id: normalizeGroup(String(g?.id?._serialized ?? g?.id?.user ?? g?.id ?? '')),
        name: String(g?.name ?? g?.contact?.name ?? g?.groupMetadata?.subject ?? 'Grupo sem nome'),
      }))
      .filter((g) => g.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async send(target: string, isGroup: boolean, message: string): Promise<void> {
    const r = await this.call('POST', '/send-message', { phone: target, isGroup, message });
    if (r?.status && r.status !== 'success' && r.status !== 'Success') {
      throw new WhatsappError(`WPPConnect recusou o envio: ${r.message ?? r.status}`);
    }
  }
}

export async function whatsappClient(): Promise<WppClient> {
  return new WppClient(await getWhatsappSettings());
}
