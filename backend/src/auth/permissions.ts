export type Role = 'admin' | 'tecnico' | 'escritorio';

/** Catálogo de permissões por funcionalidade. Rótulos usados na tela de usuários. */
export const PERMISSIONS = {
  'dashboard.view': 'Ver dashboard',
  'wireguard.view': 'Ver peers WireGuard da central',
  'wireguard.link': 'Vincular peers a equipamentos',
  'clients.view': 'Ver clientes',
  'clients.manage': 'Cadastrar/editar clientes',
  'devices.view': 'Ver equipamentos',
  'devices.manage': 'Cadastrar/editar equipamentos e credenciais',
  'monitor.view': 'Ver monitoramento (sistema, interfaces, rotas, DHCP etc.)',
  'monitor.firewall': 'Ver firewall, NAT e address lists',
  'logs.view': 'Ver logs dos equipamentos',
  'pppoe.view': 'Ver PPPoE (secrets, profiles e sessões)',
  'pppoe.password': 'Visualizar senha PPPoE (auditado)',
  'pppoe.create': 'Criar secrets PPPoE',
  'pppoe.edit': 'Editar secrets PPPoE',
  'pppoe.toggle': 'Habilitar/desabilitar secrets PPPoE',
  'pppoe.delete': 'Excluir secrets PPPoE',
  'pppoe.disconnect': 'Desconectar sessões PPPoE',
  'audit.view': 'Ver auditoria',
  'users.manage': 'Gerenciar usuários do sistema',
  'notifications.manage': 'Configurar notificações (WhatsApp)',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  tecnico: 'Técnico',
  escritorio: 'Escritório',
};

export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  tecnico: [
    'dashboard.view', 'wireguard.view', 'wireguard.link', 'clients.view', 'devices.view',
    'monitor.view', 'monitor.firewall', 'logs.view',
    'pppoe.view', 'pppoe.create', 'pppoe.edit', 'pppoe.toggle', 'pppoe.disconnect',
  ],
  // Escritório: consulta para atendimento. Criação/edição/senha concedidas individualmente.
  escritorio: ['dashboard.view', 'clients.view', 'devices.view', 'pppoe.view'],
};

export function effectivePermissions(role: Role, grant: string[], revoke: string[]): Set<Permission> {
  if (role === 'admin') return new Set(ALL_PERMISSIONS); // administrador sempre completo
  const set = new Set<Permission>(ROLE_DEFAULTS[role]);
  for (const p of grant) if (p in PERMISSIONS) set.add(p as Permission);
  for (const p of revoke) set.delete(p as Permission);
  return set;
}
