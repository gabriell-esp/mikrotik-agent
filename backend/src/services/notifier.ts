import { config } from '../config.js';
import { query } from '../db/pool.js';
import { getWhatsappSettings, WppClient } from './whatsapp.js';
import { peerState } from './wireguard.js';

export const NOTIFY_EVENTS = {
  device_down: 'Equipamento inacessível ou com erro de comunicação',
  device_auth: 'Falha de autenticação no equipamento',
  device_up: 'Equipamento voltou a responder',
  resource_high: 'CPU, memória ou armazenamento acima do limite',
  peer_lost: 'Peer WireGuard vinculado sem handshake recente',
} as const;
export type NotifyEvent = keyof typeof NOTIFY_EVENTS;
export const NOTIFY_EVENT_KEYS = Object.keys(NOTIFY_EVENTS) as NotifyEvent[];

const ICON: Record<NotifyEvent, string> = { device_down: '🔴', device_auth: '🟠', device_up: '🟢', resource_high: '🟡', peer_lost: '🔌' };
const TITLE: Record<NotifyEvent, string> = {
  device_down: 'Equipamento inacessível',
  device_auth: 'Falha de autenticação',
  device_up: 'Equipamento normalizado',
  resource_high: 'Recurso acima do limite',
  peer_lost: 'Túnel WireGuard sem handshake recente',
};

export interface Alert {
  event: NotifyEvent;
  device: { id: number; name: string; host: string; client_id: number | null; client_name: string | null; is_central: boolean };
  detail: string;
  since: Date;
}

function pct(free: unknown, total: unknown): number | null {
  const f = Number(free);
  const t = Number(total);
  return t > 0 && Number.isFinite(f) ? Math.round(100 - (f / t) * 100) : null;
}

const PROBLEM = new Set(['unreachable', 'error', 'auth_failed']);

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: config.displayTimeZone }).format(d);

export function fmtDowntime(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Compara o estado atual com o último comunicado e devolve os alertas a enviar.
 * O estado é atualizado mesmo com notificações desligadas, para não gerar avalanche ao ligar.
 */
export async function evaluateAlerts(now = new Date()): Promise<Alert[]> {
  const s = await getWhatsappSettings();
  const rows = await query(
    `SELECT d.id, d.name, d.host, d.client_id, d.is_central, d.status, d.status_message, d.status_since, d.last_ok_at,
            c.name AS client_name, st.notified_status, st.notified_at, st.resource_alerts, st.peer_alerted,
            mc.data->'sections'->'resource'->'rows'->0 AS resource, mc.collected_at AS resource_at,
            p.last_handshake_seconds, p.collected_at AS peer_collected_at, p.disabled AS peer_disabled, p.id AS peer_id
       FROM devices d
       LEFT JOIN clients c ON c.id = d.client_id
       LEFT JOIN device_alert_state st ON st.device_id = d.id
       LEFT JOIN module_cache mc ON mc.device_id = d.id AND mc.module = 'system'
       LEFT JOIN LATERAL (SELECT * FROM wg_peers WHERE device_id = d.id AND present ORDER BY id LIMIT 1) p ON TRUE
      WHERE d.poll_enabled`,
  );
  const alerts: Alert[] = [];
  for (const r of rows) {
    const device = { id: r.id, name: r.name, host: r.host, client_id: r.client_id, client_name: r.client_name, is_central: r.is_central };
    if (!r.notified_status) {
      // Primeira vez: registra o estado atual sem notificar.
      if (r.status !== 'unknown') await query('INSERT INTO device_alert_state(device_id, notified_status) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, r.status]);
      continue;
    }
    const since = r.status_since ? new Date(r.status_since) : now;

    // Mudança de status de gerência, mantida pelo tempo mínimo configurado.
    if (r.status !== 'unknown' && r.status !== r.notified_status && now.getTime() - since.getTime() >= s.delay_sec * 1000) {
      let event: NotifyEvent | null = null;
      let detail = r.status_message ?? '';
      if (r.status === 'online') {
        if (PROBLEM.has(r.notified_status)) {
          event = 'device_up';
          detail = `Voltou a responder após ${fmtDowntime(since.getTime() - new Date(r.notified_at).getTime())} de falha.`;
        }
      } else if (r.status === 'auth_failed') {
        event = 'device_auth';
      } else if (r.notified_status !== 'unreachable' && r.notified_status !== 'error') {
        // Alternar entre "inacessível" e "erro" não gera nova mensagem.
        event = 'device_down';
      }
      if (event) alerts.push({ event, device, detail, since });
      await query('UPDATE device_alert_state SET notified_status = $2, notified_at = $3 WHERE device_id = $1', [r.id, r.status, since]);
    }

    // Recursos (apenas com coleta recente e equipamento respondendo).
    const res = r.resource;
    const fresh = r.resource_at && now.getTime() - new Date(r.resource_at).getTime() < config.pollIntervalSec * 3000;
    if (r.status === 'online' && res && fresh) {
      const metrics: Record<string, number | null> = {
        CPU: res['cpu-load'] != null ? Number(res['cpu-load']) : null,
        Memória: pct(res['free-memory'], res['total-memory']),
        Armazenamento: pct(res['free-hdd-space'], res['total-hdd-space']),
      };
      const active = new Set<string>(r.resource_alerts ?? []);
      let changed = false;
      for (const [name, v] of Object.entries(metrics)) {
        if (v == null) continue;
        if (v >= s.resource_threshold && !active.has(name)) {
          active.add(name);
          changed = true;
          alerts.push({ event: 'resource_high', device, detail: `${name} em ${v}% (limite ${s.resource_threshold}%).`, since: now });
        } else if (v < s.resource_threshold - 10 && active.has(name)) {
          active.delete(name); // histerese: só volta a alertar após cair 10 pontos
          changed = true;
        }
      }
      if (changed) await query('UPDATE device_alert_state SET resource_alerts = $2 WHERE device_id = $1', [r.id, [...active]]);
    }

    // Túnel WireGuard do equipamento vinculado.
    if (r.peer_id && !r.peer_disabled) {
      const ps = peerState({ disabled: false, last_handshake_seconds: r.last_handshake_seconds, collected_at: r.peer_collected_at });
      const lost = ps === 'stale' || ps === 'never';
      if (lost && !r.peer_alerted) {
        alerts.push({ event: 'peer_lost', device, detail: 'A central não registra handshake recente deste túnel (pode ser só ausência de tráfego).', since: now });
        await query('UPDATE device_alert_state SET peer_alerted = TRUE WHERE device_id = $1', [r.id]);
      } else if (!lost && r.peer_alerted) {
        await query('UPDATE device_alert_state SET peer_alerted = FALSE WHERE device_id = $1', [r.id]);
      }
    }
  }
  return s.enabled ? alerts : [];
}

function deviceLine(a: Alert): string {
  const who = a.device.client_name ? `${a.device.name} (${a.device.client_name})` : a.device.name;
  return `${who}${a.device.is_central ? ' — *CENTRAL*' : ''}`;
}

export function buildMessage(alerts: Alert[]): string {
  const footer = '\n\n_Slot1 · Gerência MikroTik_';
  if (alerts.length === 1) {
    const a = alerts[0];
    const lines = [
      `${ICON[a.event]} *${TITLE[a.event]}*`,
      '',
      ...(a.device.client_name ? [`*Cliente:* ${a.device.client_name}`] : []),
      `*Equipamento:* ${a.device.name} (${a.device.host})`,
      ...(a.device.is_central ? ['*Atenção:* MikroTik central — pode afetar os túneis de todos os clientes.'] : []),
      ...(a.detail ? [`*Detalhe:* ${a.detail}`] : []),
      `*${a.event === 'device_up' ? 'Normalizado em' : 'Desde'}:* ${fmt(a.since)}`,
    ];
    return lines.join('\n') + footer;
  }
  const order: NotifyEvent[] = ['device_down', 'device_auth', 'resource_high', 'peer_lost', 'device_up'];
  const sorted = [...alerts].sort((x, y) => order.indexOf(x.event) - order.indexOf(y.event));
  const max = 25;
  const lines = sorted.slice(0, max).map((a) => `${ICON[a.event]} ${deviceLine(a)}: ${TITLE[a.event].toLowerCase()}${a.detail ? ` — ${a.detail}` : ''}`);
  if (sorted.length > max) lines.push(`… e mais ${sorted.length - max} alerta(s). Veja o painel.`);
  return [`⚠️ *${alerts.length} alertas de monitoramento* (${fmt(new Date())})`, '', ...lines].join('\n') + footer;
}

interface Recipient {
  id: number;
  name: string;
  target: string;
  is_group: boolean;
  events: string[];
  client_ids: number[] | null;
}

export function alertsFor(r: Recipient, alerts: Alert[]): Alert[] {
  return alerts.filter(
    (a) => r.events.includes(a.event) && (r.client_ids == null || (a.device.client_id != null && !a.device.is_central && r.client_ids.includes(a.device.client_id))),
  );
}

/** Envia com até 3 tentativas e registra o resultado. */
export async function sendLogged(client: WppClient, r: Pick<Recipient, 'id' | 'name' | 'target' | 'is_group'>, message: string, meta: { events: string[]; device_ids: number[] }) {
  let attempts = 0;
  let error: string | null = null;
  for (const wait of [0, 2000, 6000]) {
    if (wait) await new Promise((res) => setTimeout(res, wait));
    attempts++;
    try {
      await client.send(r.target, r.is_group, message);
      error = null;
      break;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  await query(
    `INSERT INTO notification_log(recipient_id, recipient_name, target, events, device_ids, message, success, attempts, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [r.id || null, r.name, r.target, meta.events, meta.device_ids, message, !error, attempts, error],
  );
  return { ok: !error, error };
}

export async function dispatch(alerts: Alert[], client?: WppClient): Promise<number> {
  if (!alerts.length) return 0;
  const wa = client ?? new WppClient(await getWhatsappSettings());
  const recipients = await query<Recipient>('SELECT * FROM notification_recipients WHERE enabled ORDER BY id');
  let sent = 0;
  for (const r of recipients) {
    const mine = alertsFor(r, alerts);
    if (!mine.length) continue;
    const res = await sendLogged(wa, r, buildMessage(mine), {
      events: [...new Set(mine.map((a) => a.event))],
      device_ids: [...new Set(mine.map((a) => a.device.id))],
    });
    if (res.ok) sent++;
  }
  return sent;
}

let running = false;
export async function runNotifier(log?: { error: (o: unknown, m?: string) => void }): Promise<void> {
  if (running) return;
  running = true;
  try {
    await dispatch(await evaluateAlerts());
  } catch (e) {
    log?.error(e, 'Falha no processamento de notificações');
  } finally {
    running = false;
  }
}
