import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { runModule } from '../modules/registry.js';
import type { ModuleData, QueryModule } from '../modules/types.js';
import { RosError } from '../routeros/types.js';
import { runOnDevice, type DeviceRow } from './devices.js';

export interface ModuleResponse {
  module: string;
  label: string;
  collectedAt: string | null;
  /** true quando a última tentativa de atualização falhou ou o dado passou do prazo. */
  stale: boolean;
  error: string | null;
  errorAt: string | null;
  deviceStatus: string;
  sections: (ModuleData['sections'][string] & { key: string; label: string })[];
}

interface CacheRow {
  data: ModuleData | null;
  collected_at: Date | null;
  last_error: string | null;
  last_error_at: Date | null;
}

const inflight = new Map<string, Promise<void>>();

async function readCache(deviceId: number, module: string): Promise<CacheRow | undefined> {
  return one<CacheRow>('SELECT data, collected_at, last_error, last_error_at FROM module_cache WHERE device_id = $1 AND module = $2', [deviceId, module]);
}

function toResponse(d: DeviceRow, m: QueryModule, row: CacheRow | undefined): ModuleResponse {
  const collected = row?.collected_at ? new Date(row.collected_at) : null;
  const errAt = row?.last_error_at ? new Date(row.last_error_at) : null;
  const failedAfter = !!errAt && (!collected || errAt > collected);
  const tooOld = !!collected && Date.now() - collected.getTime() > Math.max(m.ttlSec, config.pollIntervalSec) * 2000;
  return {
    module: m.key,
    label: m.label,
    collectedAt: collected?.toISOString() ?? null,
    stale: failedAfter || tooOld,
    error: failedAfter ? row!.last_error : null,
    errorAt: failedAfter ? errAt!.toISOString() : null,
    deviceStatus: d.status,
    sections: m.sections.map((s) => ({
      key: s.key,
      label: s.label,
      ...(row?.data?.sections?.[s.key] ?? { ok: false as const, kind: 'protocol' as const, reason: 'Ainda não coletado.' }),
    })),
  };
}

/** Pós-processamento do módulo "system": guarda versão, modelo e identidade no cadastro. */
async function afterSystem(d: DeviceRow, data: ModuleData): Promise<void> {
  const res = data.sections.resource;
  const idt = data.sections.identity;
  const rb = data.sections.routerboard;
  const r = res?.ok ? res.rows[0] : undefined;
  const version = r?.version ?? null;
  const board = (rb?.ok && rb.rows[0]?.model) || r?.['board-name'] || null;
  const identity = idt?.ok ? idt.rows[0]?.name ?? null : null;
  await query(
    'UPDATE devices SET ros_version = COALESCE($2, ros_version), board_name = COALESCE($3, board_name), identity = COALESCE($4, identity) WHERE id = $1',
    [d.id, version, board, identity],
  );
  if (version) d.ros_version = version;
}

/** Consulta o roteador e grava no cache. Erros de conexão ficam registrados sem apagar o último dado bom. */
export async function refreshModule(d: DeviceRow, m: QueryModule): Promise<void> {
  const key = `${d.id}:${m.key}`;
  const running = inflight.get(key);
  if (running) return running; // evita consultas duplicadas simultâneas
  const p = (async () => {
    try {
      const data = await runOnDevice(d, (c) => runModule(c, m, d.ros_version));
      await query(
        `INSERT INTO module_cache(device_id, module, data, collected_at, last_error, last_error_at)
         VALUES ($1,$2,$3,now(),NULL,NULL)
         ON CONFLICT (device_id, module) DO UPDATE SET data = EXCLUDED.data, collected_at = now(), last_error = NULL, last_error_at = NULL`,
        [d.id, m.key, JSON.stringify(data)],
      );
      if (m.key === 'system') await afterSystem(d, data);
    } catch (e) {
      const msg = e instanceof RosError ? e.message : `Erro interno: ${(e as Error).message}`;
      await query(
        `INSERT INTO module_cache(device_id, module, last_error, last_error_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (device_id, module) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = now()`,
        [d.id, m.key, msg],
      );
      if (!(e instanceof RosError)) throw e;
    }
  })();
  inflight.set(key, p);
  try {
    await p;
  } finally {
    inflight.delete(key);
  }
}

/** Retorna o módulo do cache se estiver dentro da validade; senão atualiza (ou devolve o último dado como desatualizado). */
export async function loadModule(d: DeviceRow, m: QueryModule, force = false): Promise<ModuleResponse> {
  const cached = await readCache(d.id, m.key);
  const age = cached?.collected_at ? Date.now() - new Date(cached.collected_at).getTime() : Infinity;
  if (force || age > m.ttlSec * 1000) {
    await refreshModule(d, m);
    return toResponse(d, m, await readCache(d.id, m.key));
  }
  return toResponse(d, m, cached);
}

export async function cachedModule(d: DeviceRow, m: QueryModule): Promise<ModuleResponse> {
  return toResponse(d, m, await readCache(d.id, m.key));
}

/** Atualiza uma seção do cache com o estado lido logo após uma alteração. */
export async function patchSection(deviceId: number, module: string, section: string, result: ModuleData['sections'][string]): Promise<void> {
  await query(
    `UPDATE module_cache SET data = jsonb_set(COALESCE(data, '{"sections":{}}'::jsonb), ARRAY['sections', $3::text], $4::jsonb)
      WHERE device_id = $1 AND module = $2`,
    [deviceId, module, section, JSON.stringify(result)],
  );
}
