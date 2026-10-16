import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { getModule } from '../modules/registry.js';
import type { DeviceRow } from './devices.js';
import { refreshModule } from './module-cache.js';
import { runNotifier } from './notifier.js';
import { syncCentralPeers } from './wireguard.js';

/** Módulos coletados periodicamente (os demais são consultados sob demanda, com cache). */
export const PERIODIC_MODULES = ['system', 'ppp'];

export const collectorState = {
  lastDeviceRunAt: null as Date | null,
  lastWgRunAt: null as Date | null,
  running: false,
};

async function pollDevice(d: DeviceRow): Promise<void> {
  for (const key of PERIODIC_MODULES) {
    if (key === 'ppp' && d.is_central) continue; // a central não é servidor PPPoE
    await refreshModule(d, getModule(key)!);
    // Se a conexão falhou, não insiste nos demais módulos neste ciclo.
    if (d.status !== 'online') break;
  }
}

export async function pollAllDevices(log?: FastifyBaseLogger): Promise<void> {
  if (collectorState.running) return;
  collectorState.running = true;
  try {
    const devices = await query<DeviceRow>('SELECT * FROM devices WHERE poll_enabled ORDER BY id');
    // A concorrência real é limitada pelos semáforos do gerenciador de conexões.
    await Promise.all(devices.map((d) => pollDevice(d).catch((e) => log?.error({ err: e, device: d.id }, 'Falha na coleta'))));
    collectorState.lastDeviceRunAt = new Date();
    void runNotifier(log);
  } finally {
    collectorState.running = false;
  }
}

export function startCollector(log: FastifyBaseLogger): () => void {
  let wgBusy = false;
  const wg = async () => {
    if (wgBusy) return;
    wgBusy = true;
    try {
      const r = await syncCentralPeers();
      if (!r.ok) log.warn(`WireGuard central: ${r.error}`);
      collectorState.lastWgRunAt = new Date();
      void runNotifier(log);
    } catch (e) {
      log.error(e, 'Falha ao sincronizar peers WireGuard');
    } finally {
      wgBusy = false;
    }
  };
  const devices = () => pollAllDevices(log).catch((e) => log.error(e, 'Falha no ciclo de coleta'));
  const t1 = setInterval(wg, config.wgPollIntervalSec * 1000);
  const t2 = setInterval(devices, config.pollIntervalSec * 1000);
  setTimeout(wg, 2000);
  setTimeout(devices, 5000);
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}
