import { config } from '../config.js';
import { versionAtLeast } from '../routeros/parse.js';
import { RosError, type RosClient, type RosRecord } from '../routeros/types.js';
import type { ModuleData, QueryModule, SectionDef, SectionResult } from './types.js';

/** Campos que nunca saem do backend nem vão para o cache (senhas, chaves privadas, PSKs). */
const SECRET_FIELD = /password|private-key|preshared-key|pre-shared-key|passphrase|secret|^key$/i;

export function stripSecrets(row: RosRecord): RosRecord {
  const out: RosRecord = {};
  for (const [k, v] of Object.entries(row)) if (!SECRET_FIELD.test(k)) out[k] = v;
  return out;
}

const ttl = config.cacheTtlSec;

/**
 * Registro de módulos de consulta. Para incluir um novo módulo basta acrescentar uma entrada:
 * a API (/api/devices/:id/modules/:key) e o cache passam a atendê-lo automaticamente.
 */
export const MODULES: QueryModule[] = [
  {
    key: 'system',
    label: 'Sistema',
    permission: 'monitor.view',
    ttlSec: 30,
    sections: [
      { key: 'resource', label: 'Recursos', path: '/system/resource', single: true },
      { key: 'identity', label: 'Identidade', path: '/system/identity', single: true },
      { key: 'routerboard', label: 'RouterBOARD', path: '/system/routerboard', single: true },
      { key: 'clock', label: 'Relógio', path: '/system/clock', single: true },
      { key: 'health', label: 'Sensores', path: '/system/health' },
      { key: 'license', label: 'Licença', path: '/system/license', single: true },
      { key: 'packages', label: 'Pacotes', path: '/system/package' },
      { key: 'disks', label: 'Discos', path: '/disk', minVersion: '7.0' },
    ],
  },
  {
    key: 'interfaces',
    label: 'Interfaces',
    permission: 'monitor.view',
    ttlSec: ttl,
    sections: [
      { key: 'interfaces', label: 'Interfaces', path: '/interface' },
      { key: 'addresses', label: 'Endereços IPv4', path: '/ip/address' },
      { key: 'addresses6', label: 'Endereços IPv6', path: '/ipv6/address', requires: 'pacote ipv6' },
      { key: 'bridges', label: 'Bridges', path: '/interface/bridge' },
      { key: 'bridgePorts', label: 'Portas de bridge', path: '/interface/bridge/port' },
      { key: 'vlans', label: 'VLANs', path: '/interface/vlan' },
      { key: 'arp', label: 'ARP', path: '/ip/arp' },
      { key: 'neighbors', label: 'Vizinhos', path: '/ip/neighbor' },
    ],
  },
  {
    key: 'vpn',
    label: 'VPN',
    permission: 'monitor.view',
    ttlSec: ttl,
    sections: [
      { key: 'wireguard', label: 'Interfaces WireGuard', path: '/interface/wireguard', minVersion: '7.0' },
      { key: 'wgPeers', label: 'Peers WireGuard', path: '/interface/wireguard/peers', minVersion: '7.0' },
      { key: 'pppActive', label: 'Sessões PPP ativas (todas)', path: '/ppp/active' },
      { key: 'l2tp', label: 'Servidor L2TP', path: '/interface/l2tp-server/server', single: true },
      { key: 'pptp', label: 'Servidor PPTP', path: '/interface/pptp-server/server', single: true },
      { key: 'sstp', label: 'Servidor SSTP', path: '/interface/sstp-server/server', single: true },
      { key: 'ovpn', label: 'Servidores OpenVPN', path: '/interface/ovpn-server/server' },
      { key: 'eoip', label: 'Túneis EoIP', path: '/interface/eoip' },
      { key: 'gre', label: 'Túneis GRE', path: '/interface/gre' },
      { key: 'ipsecPeers', label: 'IPsec — peers ativos', path: '/ip/ipsec/active-peers' },
    ],
  },
  {
    key: 'routes',
    label: 'Rotas',
    permission: 'monitor.view',
    ttlSec: ttl,
    sections: [
      { key: 'routes', label: 'Rotas IPv4', path: '/ip/route' },
      { key: 'routes6', label: 'Rotas IPv6', path: '/ipv6/route', requires: 'pacote ipv6' },
      { key: 'bgp7', label: 'Sessões BGP', path: '/routing/bgp/session', minVersion: '7.0' },
      { key: 'bgp6', label: 'Peers BGP', path: '/routing/bgp/peer', beforeVersion: '7.0' },
      { key: 'ospf', label: 'Vizinhos OSPF', path: '/routing/ospf/neighbor' },
    ],
  },
  {
    key: 'firewall',
    label: 'Firewall',
    permission: 'monitor.firewall',
    ttlSec: ttl,
    sections: [
      { key: 'filter', label: 'Filter', path: '/ip/firewall/filter' },
      { key: 'nat', label: 'NAT', path: '/ip/firewall/nat' },
      { key: 'mangle', label: 'Mangle', path: '/ip/firewall/mangle' },
      { key: 'raw', label: 'Raw', path: '/ip/firewall/raw' },
      { key: 'addressList', label: 'Address lists', path: '/ip/firewall/address-list' },
      { key: 'services', label: 'Serviços IP', path: '/ip/service' },
    ],
  },
  {
    key: 'dhcp',
    label: 'DHCP e DNS',
    permission: 'monitor.view',
    ttlSec: ttl,
    sections: [
      { key: 'servers', label: 'Servidores DHCP', path: '/ip/dhcp-server' },
      { key: 'leases', label: 'Leases', path: '/ip/dhcp-server/lease' },
      { key: 'networks', label: 'Redes DHCP', path: '/ip/dhcp-server/network' },
      { key: 'pools', label: 'Pools', path: '/ip/pool' },
      { key: 'poolUsed', label: 'Pools — em uso', path: '/ip/pool/used' },
      { key: 'clients', label: 'Clientes DHCP', path: '/ip/dhcp-client' },
      { key: 'dns', label: 'DNS', path: '/ip/dns', single: true },
      { key: 'dnsStatic', label: 'DNS estático', path: '/ip/dns/static' },
    ],
  },
  {
    key: 'queues',
    label: 'Filas',
    permission: 'monitor.view',
    ttlSec: ttl,
    sections: [
      { key: 'simple', label: 'Simple queues', path: '/queue/simple' },
      { key: 'tree', label: 'Queue tree', path: '/queue/tree' },
      { key: 'types', label: 'Tipos de fila', path: '/queue/type' },
    ],
  },
  {
    key: 'logs',
    label: 'Logs',
    permission: 'logs.view',
    ttlSec: 20,
    sections: [
      { key: 'log', label: 'Log', path: '/log' },
      { key: 'clock', label: 'Relógio', path: '/system/clock', single: true },
    ],
  },
  {
    key: 'ppp',
    label: 'PPPoE',
    permission: 'pppoe.view',
    ttlSec: 30,
    sections: [
      { key: 'secrets', label: 'Secrets', path: '/ppp/secret' },
      { key: 'profiles', label: 'Profiles', path: '/ppp/profile' },
      { key: 'active', label: 'Sessões ativas', path: '/ppp/active' },
      { key: 'servers', label: 'Servidores PPPoE', path: '/interface/pppoe-server/server' },
    ],
  },
];

export function getModule(key: string): QueryModule | undefined {
  return MODULES.find((m) => m.key === key);
}

const KIND_REASON: Record<string, string> = {
  unsupported: 'Menu inexistente nesta versão do RouterOS ou pacote não instalado',
  permission: 'O usuário do roteador não tem permissão de leitura neste menu',
  timeout: 'O roteador não respondeu no prazo',
};

export async function fetchSection(c: RosClient, s: SectionDef, version: string | null): Promise<SectionResult> {
  if (version && s.minVersion && !versionAtLeast(version, s.minVersion)) {
    return { ok: false, kind: 'version', reason: `Requer RouterOS ${s.minVersion} ou superior (equipamento: ${version}).` };
  }
  if (version && s.beforeVersion && versionAtLeast(version, s.beforeVersion)) {
    return { ok: false, kind: 'version', reason: `Menu substituído a partir do RouterOS ${s.beforeVersion}.` };
  }
  try {
    let rows = (await c.print(s.path)).map(stripSecrets);
    if (s.transform) rows = s.transform(rows);
    return { ok: true, rows, ...(s.single ? { single: true } : {}) };
  } catch (e) {
    if (!(e instanceof RosError)) throw e;
    // Falhas de conexão/timeout derrubam a coleta inteira; erros de menu ficam por seção.
    if (e.kind === 'timeout' || e.kind === 'protocol') throw e;
    const base = KIND_REASON[e.kind] ?? 'Erro retornado pelo roteador';
    const extra = s.requires && e.kind === 'unsupported' ? ` (requer ${s.requires})` : '';
    return { ok: false, kind: e.kind, reason: `${base}${extra}: ${e.message}` };
  }
}

export async function runModule(c: RosClient, m: QueryModule, version: string | null): Promise<ModuleData> {
  if (m.fetch) return m.fetch(c, version);
  const sections: ModuleData['sections'] = {};
  for (const s of m.sections) sections[s.key] = await fetchSection(c, s, version);
  return { sections };
}
