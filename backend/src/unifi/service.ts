import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { secretBox } from '../lib/secrets.js';
import { Semaphore } from '../lib/semaphore.js';
import { UnifiClient, UnifiError } from './client.js';

export interface ControllerRow {
  id: number;
  client_id: number | null;
  name: string;
  url: string;
  username: string;
  password_enc: string;
  tls_fingerprint: string | null;
  platform: 'unifios' | 'legacy' | null;
  version: string | null;
  status: string;
  poll_enabled: boolean;
}

export type ControllerStatus = 'unknown' | 'online' | 'unreachable' | 'auth_failed' | 'error';

export async function getController(id: number): Promise<ControllerRow> {
  const c = await one<ControllerRow>('SELECT * FROM unifi_controllers WHERE id = $1', [id]);
  if (!c) throw notFound('Controladora não encontrada.');
  return c;
}

// ------------------------------------------------------------------ sessões

interface Session {
  key: string;
  client: UnifiClient;
}
const sessions = new Map<number, Session>();
const limits = new Map<number, Semaphore>();
const globalLimit = new Semaphore(config.ros.maxConcurrent);

function sessionKey(c: ControllerRow): string {
  return createHash('sha256').update([c.url, c.username, c.password_enc, c.tls_fingerprint ?? ''].join('|')).digest('hex');
}

function decryptPassword(c: ControllerRow): string {
  try {
    return secretBox().decrypt(c.password_enc);
  } catch {
    throw new UnifiError('auth', `Não foi possível decifrar a senha salva de "${c.name}" (chave mestra diferente da usada no cadastro). Salve a senha novamente.`);
  }
}

function sessionFor(c: ControllerRow): UnifiClient {
  const key = sessionKey(c);
  const cur = sessions.get(c.id);
  if (cur && cur.key === key) return cur.client;
  cur?.client.close();
  const client = new UnifiClient({ url: c.url, username: c.username, password: decryptPassword(c), tlsFingerprint: c.tls_fingerprint, platform: c.platform });
  sessions.set(c.id, { key, client });
  return client;
}

export function dropSession(id: number): void {
  sessions.get(id)?.client.close();
  sessions.delete(id);
}

export function statusFromUnifiError(e: UnifiError): ControllerStatus {
  return e.kind === 'unreachable' || e.kind === 'refused' ? 'unreachable' : e.kind === 'auth' ? 'auth_failed' : 'error';
}

async function setStatus(id: number, status: ControllerStatus, message: string | null, extra: { platform?: string | null; version?: string | null } = {}) {
  await query(
    `UPDATE unifi_controllers SET
       status_since = CASE WHEN status IS DISTINCT FROM $2 THEN now() ELSE COALESCE(status_since, now()) END,
       status = $2, status_message = $3, last_poll_at = now(),
       last_ok_at = CASE WHEN $2 = 'online' THEN now() ELSE last_ok_at END,
       platform = COALESCE($4, platform), version = COALESCE($5, version)
     WHERE id = $1`,
    [id, status, message, extra.platform ?? null, extra.version ?? null],
  );
}

/**
 * Executa operações na controladora com limite de concorrência, sessão reaproveitada
 * e status de conexão atualizado conforme o resultado.
 */
export async function withController<T>(c: ControllerRow, fn: (api: UnifiClient) => Promise<T>): Promise<T> {
  let lim = limits.get(c.id);
  if (!lim) limits.set(c.id, (lim = new Semaphore(1)));
  const releaseCtrl = await lim.acquire();
  const releaseGlobal = await globalLimit.acquire();
  try {
    const api = sessionFor(c);
    const out = await fn(api);
    if (c.status !== 'online' || api.platform !== c.platform) {
      await setStatus(c.id, 'online', null, { platform: api.platform, version: api.version });
      c.status = 'online';
      c.platform = api.platform;
    } else {
      await query('UPDATE unifi_controllers SET last_poll_at = now(), last_ok_at = now(), version = COALESCE($2, version) WHERE id = $1', [c.id, api.version]);
    }
    return out;
  } catch (e) {
    if (e instanceof UnifiError && e.kind !== 'command') {
      dropSession(c.id);
      const st = statusFromUnifiError(e);
      await setStatus(c.id, st, e.message);
      c.status = st;
    }
    throw e;
  } finally {
    releaseGlobal();
    releaseCtrl();
  }
}

// ------------------------------------------------------------------ normalização

const STATE: Record<number, string> = {
  0: 'offline', 1: 'online', 2: 'pending', 4: 'upgrading', 5: 'provisioning', 6: 'heartbeat_missed',
  7: 'adopting', 9: 'adoption_error', 10: 'adoption_failed', 11: 'isolated',
};

/** Nomes comerciais dos modelos mais comuns (o código aparece quando não está na lista). */
const MODELS: Record<string, string> = {
  U7PG2: 'UAP-AC-Pro', U7LT: 'UAP-AC-Lite', U7LR: 'UAP-AC-LR', U7NHD: 'UAP-nanoHD', U7MSH: 'UAP-AC-Mesh', U7MP: 'UAP-AC-Mesh-Pro',
  U7IW: 'UAP-AC-IW', UFLHD: 'UAP-FlexHD', UHDIW: 'UAP-IW-HD', UAL6: 'U6 Lite', UALR6: 'U6 LR', UAP6MP: 'U6 Pro', UAM6: 'U6 Mesh',
  U6IW: 'U6 In-Wall', U6ENT: 'U6 Enterprise', UCK: 'Cloud Key', UCKG2: 'Cloud Key Gen2', UCKP: 'Cloud Key Gen2 Plus',
};

const band = (r?: string) => (r === 'ng' ? '2,4 GHz' : r === 'na' ? '5 GHz' : r === '6e' ? '6 GHz' : r ?? null);

export function normalizeDevice(d: any) {
  return {
    id: d._id,
    mac: d.mac,
    name: d.name || MODELS[d.model] || d.model || d.mac,
    model: d.model ?? null,
    model_name: MODELS[d.model] ?? d.model ?? null,
    type: d.type ?? null,
    ip: d.ip ?? null,
    version: d.version ?? null,
    state: STATE[d.state] ?? (d.state != null ? `state_${d.state}` : 'unknown'),
    adopted: d.adopted !== false,
    uptime: d.uptime ?? null,
    clients: d.num_sta ?? 0,
    upgradable: !!d.upgradable,
    upgrade_to: d.upgrade_to_firmware ?? null,
    locating: !!d.locating,
    satisfaction: d.satisfaction ?? null,
    last_seen: d.last_seen ? new Date(d.last_seen * 1000).toISOString() : null,
    uplink: d.uplink?.type ?? null,
    tx_bytes: d.tx_bytes ?? null,
    rx_bytes: d.rx_bytes ?? null,
    radios: (d.radio_table_stats ?? d.radio_table ?? []).map((r: any) => ({
      name: r.name,
      band: band(r.radio),
      channel: r.channel ?? null,
      tx_power: r.tx_power ?? null,
      clients: r.num_sta ?? r['user-num_sta'] ?? null,
      utilization: r.cu_total ?? null,
      satisfaction: r.satisfaction ?? null,
    })),
  };
}

export function normalizeClient(c: any, apNames: Map<string, string>) {
  return {
    mac: c.mac,
    name: c.name || c.hostname || c.oui || c.mac,
    hostname: c.hostname ?? null,
    vendor: c.oui ?? null,
    ip: c.ip ?? null,
    ap_mac: c.ap_mac ?? null,
    ap_name: c.ap_mac ? apNames.get(c.ap_mac) ?? c.ap_mac : null,
    essid: c.essid ?? null,
    signal: c.signal ?? null,
    band: band(c.radio),
    channel: c.channel ?? null,
    tx_rate: c.tx_rate ?? null,
    rx_rate: c.rx_rate ?? null,
    uptime: c.uptime ?? null,
    rx_bytes: c.rx_bytes ?? null,
    tx_bytes: c.tx_bytes ?? null,
    wired: !!c.is_wired,
    guest: !!c.is_guest,
    satisfaction: c.satisfaction ?? null,
  };
}

const wlanBand = (b: string) => ({ '2g': '2,4 GHz', '5g': '5 GHz', '6g': '6 GHz', both: '2,4 + 5 GHz' } as Record<string, string>)[b] ?? b;

export function normalizeWlan(w: any, clientsBySsid: Map<string, number>) {
  return {
    id: w._id,
    name: w.name,
    enabled: w.enabled !== false,
    security: w.security ?? null,
    wpa_mode: w.wpa_mode ?? null,
    guest: !!w.is_guest,
    hidden: !!w.hide_ssid,
    band: (Array.isArray(w.wlan_bands) ? w.wlan_bands : w.wlan_band ? [w.wlan_band] : []).map(wlanBand).join(', ') || null,
    vlan: w.vlan_enabled ? w.vlan ?? w.networkconf_id ?? null : null,
    clients: clientsBySsid.get(w.name) ?? 0,
  };
}

// ------------------------------------------------------------------ cache

export type CacheKind = 'sites' | 'devices' | 'clients' | 'wlans' | 'blocked' | 'health';

async function saveCache(id: number, site: string, kind: CacheKind, data: unknown) {
  await query(
    `INSERT INTO unifi_cache(controller_id, site, kind, data, collected_at, last_error, last_error_at) VALUES ($1,$2,$3,$4,now(),NULL,NULL)
     ON CONFLICT (controller_id, site, kind) DO UPDATE SET data = EXCLUDED.data, collected_at = now(), last_error = NULL, last_error_at = NULL`,
    [id, site, kind, JSON.stringify(data)],
  );
}

async function saveError(id: number, site: string, kind: CacheKind, message: string) {
  await query(
    `INSERT INTO unifi_cache(controller_id, site, kind, last_error, last_error_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (controller_id, site, kind) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = now()`,
    [id, site, kind, message],
  );
}

export async function readCache(id: number, site: string, kind: CacheKind) {
  const r = await one('SELECT data, collected_at, last_error, last_error_at FROM unifi_cache WHERE controller_id = $1 AND site = $2 AND kind = $3', [id, site, kind]);
  const collected = r?.collected_at ? new Date(r.collected_at) : null;
  const errAt = r?.last_error_at ? new Date(r.last_error_at) : null;
  const failed = !!errAt && (!collected || errAt > collected);
  const old = !!collected && Date.now() - collected.getTime() > config.unifiPollIntervalSec * 2500;
  return {
    data: r?.data ?? null,
    collectedAt: collected?.toISOString() ?? null,
    stale: failed || old || !collected,
    error: failed ? r!.last_error : null,
  };
}

/** Lê tudo da controladora (todos os sites) e atualiza o cache. Somente leitura. */
export async function refreshController(c: ControllerRow): Promise<{ ok: boolean; error?: string }> {
  try {
    await withController(c, async (api) => {
      const sites = (await api.sites()).map((s) => ({ name: s.name, desc: s.desc || s.name, role: s.role ?? null }));
      if (sites.length) await api.sysinfo(sites[0].name).catch(() => undefined);
      await saveCache(c.id, '', 'sites', sites);
      for (const s of sites) {
        const [devs, stas, wlans, health, known] = await Promise.all([
          api.devices(s.name),
          api.clients(s.name),
          api.wlans(s.name).catch(() => null),
          api.health(s.name).catch(() => null),
          api.knownClients(s.name).catch(() => null),
        ]);
        const devices = devs.map(normalizeDevice);
        const apNames = new Map(devices.map((d) => [d.mac, d.name] as [string, string]));
        const clients = stas.map((x) => normalizeClient(x, apNames));
        const bySsid = new Map<string, number>();
        for (const cl of clients) if (cl.essid) bySsid.set(cl.essid, (bySsid.get(cl.essid) ?? 0) + 1);
        await saveCache(c.id, s.name, 'devices', devices);
        await saveCache(c.id, s.name, 'clients', clients);
        if (wlans) await saveCache(c.id, s.name, 'wlans', wlans.map((w) => normalizeWlan(w, bySsid)));
        if (health) await saveCache(c.id, s.name, 'health', health.map((h) => ({ subsystem: h.subsystem, status: h.status, num_ap: h.num_ap, num_adopted: h.num_adopted, num_disconnected: h.num_disconnected, num_user: h.num_user })));
        if (known) await saveCache(c.id, s.name, 'blocked', known.filter((k) => k.blocked).map((k) => ({ mac: k.mac, name: k.name || k.hostname || k.oui || k.mac })));
      }
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof UnifiError ? e.message : `Erro interno: ${(e as Error).message}`;
    await saveError(c.id, '', 'sites', msg);
    if (!(e instanceof UnifiError)) throw e;
    return { ok: false, error: msg };
  }
}

/** Resumo para listas e dashboard, calculado a partir do cache. */
export async function controllerSummary(id: number) {
  const rows = await query('SELECT site, kind, data FROM unifi_cache WHERE controller_id = $1 AND data IS NOT NULL', [id]);
  const sites = rows.find((r) => r.site === '' && r.kind === 'sites')?.data ?? [];
  let devices = 0, online = 0, offline = 0, pending = 0, upgradable = 0, aps = 0, clients = 0;
  for (const r of rows) {
    if (r.kind === 'devices') {
      for (const d of r.data) {
        devices++;
        if (d.type === 'uap') aps++;
        if (d.state === 'online' || d.state === 'upgrading' || d.state === 'provisioning') online++;
        else if (d.state === 'pending') pending++;
        else offline++;
        if (d.upgradable) upgradable++;
      }
    }
    if (r.kind === 'clients') clients += r.data.length;
  }
  return { sites: sites.length, devices, aps, online, offline, pending, upgradable, clients };
}
