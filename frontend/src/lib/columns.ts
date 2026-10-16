/**
 * Colunas preferidas por seção (módulo.seção). Seções sem configuração mostram todos os campos
 * retornados pelo roteador — novos módulos funcionam sem alterar o frontend.
 */
export type ColFmt = 'bool' | 'bytes' | 'mono' | 'flag';
export interface Col {
  key: string;
  label: string;
  fmt?: ColFmt;
}

const c = (key: string, label: string, fmt?: ColFmt): Col => ({ key, label, fmt });
const comment = c('comment', 'Comentário');
const disabled = c('disabled', 'Desab.', 'flag');
const dynamic = c('dynamic', 'Dinâm.', 'flag');

const fw = [c('chain', 'Chain'), c('action', 'Ação'), c('protocol', 'Proto'), c('src-address', 'Origem', 'mono'), c('dst-address', 'Destino', 'mono'),
  c('dst-port', 'Porta dst'), c('in-interface', 'In'), c('out-interface', 'Out'), c('src-address-list', 'Lista origem'), c('dst-address-list', 'Lista destino'),
  c('connection-state', 'Estado conexão'), c('bytes', 'Bytes', 'bytes'), c('packets', 'Pacotes'), disabled, comment];

export const COLUMNS: Record<string, Col[]> = {
  'interfaces.interfaces': [c('name', 'Nome'), c('type', 'Tipo'), c('running', 'Ativa', 'bool'), disabled, c('actual-mtu', 'MTU'), c('mac-address', 'MAC', 'mono'),
    c('rx-byte', 'Recebido', 'bytes'), c('tx-byte', 'Enviado', 'bytes'), c('last-link-up-time', 'Último link up'), c('link-downs', 'Quedas'), comment],
  'interfaces.addresses': [c('address', 'Endereço', 'mono'), c('network', 'Rede', 'mono'), c('interface', 'Interface'), disabled, dynamic, comment],
  'interfaces.addresses6': [c('address', 'Endereço', 'mono'), c('interface', 'Interface'), c('advertise', 'Anuncia', 'bool'), disabled, dynamic, comment],
  'interfaces.bridges': [c('name', 'Nome'), c('protocol-mode', 'STP'), c('vlan-filtering', 'VLAN filtering', 'bool'), c('mac-address', 'MAC', 'mono'), disabled, comment],
  'interfaces.bridgePorts': [c('bridge', 'Bridge'), c('interface', 'Interface'), c('pvid', 'PVID'), c('status', 'Status'), disabled, comment],
  'interfaces.vlans': [c('name', 'Nome'), c('vlan-id', 'VLAN'), c('interface', 'Interface'), c('running', 'Ativa', 'bool'), disabled, comment],
  'interfaces.arp': [c('address', 'IP', 'mono'), c('mac-address', 'MAC', 'mono'), c('interface', 'Interface'), c('status', 'Status'), dynamic, comment],
  'interfaces.neighbors': [c('identity', 'Identidade'), c('address', 'IP', 'mono'), c('mac-address', 'MAC', 'mono'), c('interface', 'Interface'), c('platform', 'Plataforma'), c('board', 'Modelo'), c('version', 'Versão')],
  'vpn.wireguard': [c('name', 'Nome'), c('listen-port', 'Porta'), c('mtu', 'MTU'), c('public-key', 'Chave pública', 'mono'), c('running', 'Ativa', 'bool'), disabled],
  'vpn.wgPeers': [c('name', 'Nome'), comment, c('interface', 'Interface'), c('allowed-address', 'Allowed', 'mono'), c('endpoint-address', 'Endpoint'), c('current-endpoint-address', 'Endpoint atual'),
    c('last-handshake', 'Handshake'), c('rx', 'Rx', 'bytes'), c('tx', 'Tx', 'bytes'), disabled],
  'vpn.pppActive': [c('name', 'Usuário'), c('service', 'Serviço'), c('address', 'Endereço', 'mono'), c('caller-id', 'Caller ID', 'mono'), c('uptime', 'Uptime'), c('encoding', 'Criptografia')],
  'vpn.ipsecPeers': [c('remote-address', 'Remoto', 'mono'), c('local-address', 'Local', 'mono'), c('state', 'Estado'), c('uptime', 'Uptime'), c('rx-bytes', 'Rx', 'bytes'), c('tx-bytes', 'Tx', 'bytes')],
  'vpn.eoip': [c('name', 'Nome'), c('local-address', 'Local', 'mono'), c('remote-address', 'Remoto', 'mono'), c('tunnel-id', 'Tunnel ID'), c('running', 'Ativa', 'bool'), disabled],
  'vpn.gre': [c('name', 'Nome'), c('local-address', 'Local', 'mono'), c('remote-address', 'Remoto', 'mono'), c('running', 'Ativa', 'bool'), disabled],
  'routes.routes': [c('dst-address', 'Destino', 'mono'), c('gateway', 'Gateway', 'mono'), c('distance', 'Dist.'), c('routing-table', 'Tabela'), c('routing-mark', 'Routing mark'),
    c('active', 'Ativa', 'bool'), dynamic, c('static', 'Estática', 'flag'), disabled, comment],
  'routes.routes6': [c('dst-address', 'Destino', 'mono'), c('gateway', 'Gateway', 'mono'), c('distance', 'Dist.'), c('active', 'Ativa', 'bool'), dynamic, disabled, comment],
  'routes.bgp7': [c('name', 'Nome'), c('remote.address', 'Remoto', 'mono'), c('remote.as', 'AS remoto'), c('established', 'Estabelecida', 'bool'), c('uptime', 'Uptime'), c('prefix-count', 'Prefixos')],
  'routes.bgp6': [c('name', 'Nome'), c('remote-address', 'Remoto', 'mono'), c('remote-as', 'AS remoto'), c('state', 'Estado'), c('uptime', 'Uptime'), c('prefix-count', 'Prefixos'), disabled],
  'routes.ospf': [c('router-id', 'Router ID', 'mono'), c('address', 'Endereço', 'mono'), c('interface', 'Interface'), c('state', 'Estado'), c('adjacency', 'Adjacência')],
  'firewall.filter': fw,
  'firewall.nat': [c('chain', 'Chain'), c('action', 'Ação'), c('protocol', 'Proto'), c('src-address', 'Origem', 'mono'), c('dst-address', 'Destino', 'mono'), c('dst-port', 'Porta dst'),
    c('in-interface', 'In'), c('out-interface', 'Out'), c('to-addresses', 'Para endereço', 'mono'), c('to-ports', 'Para porta'), c('bytes', 'Bytes', 'bytes'), disabled, comment],
  'firewall.mangle': [...fw.slice(0, 10), c('new-routing-mark', 'Routing mark'), c('new-packet-mark', 'Packet mark'), c('new-connection-mark', 'Conn mark'), c('bytes', 'Bytes', 'bytes'), disabled, comment],
  'firewall.raw': fw,
  'firewall.addressList': [c('list', 'Lista'), c('address', 'Endereço', 'mono'), c('timeout', 'Timeout'), c('creation-time', 'Criado em'), dynamic, disabled, comment],
  'firewall.services': [c('name', 'Serviço'), c('port', 'Porta'), c('address', 'Permitido de', 'mono'), c('certificate', 'Certificado'), c('tls-version', 'TLS'), disabled],
  'dhcp.servers': [c('name', 'Nome'), c('interface', 'Interface'), c('address-pool', 'Pool'), c('lease-time', 'Lease'), disabled],
  'dhcp.leases': [c('address', 'IP', 'mono'), c('mac-address', 'MAC', 'mono'), c('host-name', 'Hostname'), c('server', 'Servidor'), c('status', 'Status'), c('expires-after', 'Expira em'),
    c('last-seen', 'Visto há'), dynamic, disabled, comment],
  'dhcp.networks': [c('address', 'Rede', 'mono'), c('gateway', 'Gateway', 'mono'), c('dns-server', 'DNS', 'mono'), c('domain', 'Domínio'), comment],
  'dhcp.pools': [c('name', 'Nome'), c('ranges', 'Faixas', 'mono'), c('next-pool', 'Próximo pool'), comment],
  'dhcp.poolUsed': [c('pool', 'Pool'), c('address', 'Endereço', 'mono'), c('owner', 'Dono'), c('info', 'Info')],
  'dhcp.clients': [c('interface', 'Interface'), c('status', 'Status'), c('address', 'Endereço', 'mono'), c('gateway', 'Gateway', 'mono'), c('primary-dns', 'DNS', 'mono'), disabled],
  'dhcp.dnsStatic': [c('name', 'Nome'), c('regexp', 'Regexp'), c('address', 'Endereço', 'mono'), c('type', 'Tipo'), c('ttl', 'TTL'), disabled, comment],
  'queues.simple': [c('name', 'Nome'), c('target', 'Alvo', 'mono'), c('max-limit', 'Limite (up/down)'), c('limit-at', 'Garantido'), c('burst-limit', 'Burst'), c('parent', 'Pai'),
    c('rate', 'Taxa atual'), c('bytes', 'Bytes'), dynamic, disabled, comment],
  'queues.tree': [c('name', 'Nome'), c('parent', 'Pai'), c('packet-mark', 'Packet mark'), c('max-limit', 'Limite'), c('limit-at', 'Garantido'), c('priority', 'Prior.'), c('rate', 'Taxa'), disabled, comment],
  'queues.types': [c('name', 'Nome'), c('kind', 'Tipo'), c('pcq-rate', 'PCQ rate'), c('pcq-classifier', 'Classificador')],
  'ppp.profiles': [c('name', 'Nome'), c('local-address', 'Endereço local', 'mono'), c('remote-address', 'Endereço remoto / pool'), c('rate-limit', 'Rate limit'),
    c('dns-server', 'DNS', 'mono'), c('only-one', 'Só um'), c('parent-queue', 'Fila pai'), comment],
  'ppp.servers': [c('service-name', 'Serviço'), c('interface', 'Interface'), c('default-profile', 'Perfil padrão'), c('authentication', 'Autenticação'), c('one-session-per-host', 'Uma sessão/host', 'bool'), disabled],
  'system.health': [c('name', 'Sensor'), c('value', 'Valor'), c('type', 'Unidade')],
  'system.packages': [c('name', 'Pacote'), c('version', 'Versão'), c('build-time', 'Build'), disabled],
  'system.disks': [c('slot', 'Slot'), c('model', 'Modelo'), c('size', 'Tamanho', 'bytes'), c('free', 'Livre', 'bytes'), c('fs', 'FS')],
};

export function columnsFor(module: string, section: string, rows: Record<string, string>[]): Col[] {
  const pref = COLUMNS[`${module}.${section}`];
  if (pref) {
    // Mantém só colunas presentes em ao menos uma linha (versões diferentes retornam campos diferentes).
    const present = pref.filter((col) => rows.some((r) => r[col.key] !== undefined && r[col.key] !== ''));
    return present.length ? present : pref.slice(0, 4);
  }
  const keys = new Set<string>();
  rows.slice(0, 50).forEach((r) => Object.keys(r).forEach((k) => !k.startsWith('.') && keys.add(k)));
  return [...keys].map((k) => ({ key: k, label: k }));
}
