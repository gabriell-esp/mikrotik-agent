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
  'unifi.view': 'Ver controladoras UniFi (antenas, clientes e redes Wi-Fi)',
  'unifi.manage': 'Cadastrar/editar controladoras UniFi e credenciais',
  'unifi.control': 'Controlar UniFi (reiniciar/atualizar antenas, clientes e redes Wi-Fi)',
  'os.view_all': 'Ver todas as ordens de serviço',
  'os.manage': 'Abrir, atribuir, editar, reabrir e cancelar ordens de serviço',
  'os.execute': 'Executar ordens de serviço atribuídas (cronômetro, relatório, gastos e fotos)',
  'planner.manage': 'Planejamento: ordens futuras, orçamentos e lembretes',
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
    'unifi.view', 'unifi.control',
    'os.execute',
  ],
  // Escritório: consulta para atendimento. Criação/edição/senha concedidas individualmente.
  escritorio: ['dashboard.view', 'clients.view', 'devices.view', 'pppoe.view', 'os.view_all', 'os.manage'],
};

/**
 * Permissões efetivas. Administrador: todas. Demais: base = soma dos grupos do usuário (se tiver algum)
 * ou o padrão do perfil; depois os ajustes individuais (concedidas entram, removidas saem).
 * groupPerms null = usuário sem grupo.
 */
export function effectivePermissions(role: Role, grant: string[], revoke: string[], groupPerms: string[] | null = null): Set<Permission> {
  if (role === 'admin') return new Set(ALL_PERMISSIONS); // administrador sempre completo
  const set = new Set<Permission>(groupPerms ? groupPerms.filter((p): p is Permission => p in PERMISSIONS) : ROLE_DEFAULTS[role]);
  for (const p of grant) if (p in PERMISSIONS) set.add(p as Permission);
  for (const p of revoke) set.delete(p as Permission);
  return set;
}

/** Colunas SQL com os grupos de um usuário (alias da tabela users). group_permissions é NULL sem grupo. */
export const userGroupColumns = (u: string) => `
  (SELECT COALESCE(array_agg(ug.group_id ORDER BY ug.group_id), '{}') FROM user_groups ug WHERE ug.user_id = ${u}.id) AS group_ids,
  (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE COALESCE(array_agg(DISTINCT gp.p) FILTER (WHERE gp.p IS NOT NULL), '{}') END
     FROM user_groups ug JOIN permission_groups g ON g.id = ug.group_id LEFT JOIN LATERAL unnest(g.permissions) AS gp(p) ON TRUE
    WHERE ug.user_id = ${u}.id) AS group_permissions`;
