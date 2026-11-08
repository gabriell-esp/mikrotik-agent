import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BellRing, Building2, ChevronDown, ChevronsLeft, ChevronsRight, ClipboardList, KeyRound, LayoutDashboard, ListTodo, LogOut, Menu, Network, Router,
  ScrollText, Search, UserRound, Users, Waypoints, Wifi, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import Avatar from './Avatar';
import CommandPalette from './CommandPalette';
import LiveIndicator from './LiveIndicator';

/** perm: permissão exigida; com várias separadas por "|", basta ter uma. */
interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; perm: string }

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Monitoramento', items: [
    { to: '/', label: 'Dashboard', short: 'Início', icon: LayoutDashboard, perm: 'dashboard.view' },
    { to: '/wireguard', label: 'WireGuard', icon: Waypoints, perm: 'wireguard.view' },
    { to: '/equipamentos', label: 'Equipamentos', short: 'Equip.', icon: Router, perm: 'devices.view' },
    { to: '/unifi', label: 'UniFi', icon: Wifi, perm: 'unifi.view' },
  ] },
  { title: 'Atendimento', items: [
    { to: '/os', label: 'Ordens de serviço', short: 'Ordens', icon: ClipboardList, perm: 'os.view_all|os.manage|os.execute' },
    { to: '/planejamento', label: 'Planejamento', icon: ListTodo, perm: 'planner.manage' },
    { to: '/pppoe', label: 'PPPoE', icon: Network, perm: 'pppoe.view' },
    { to: '/clientes', label: 'Clientes', icon: Building2, perm: 'clients.view' },
  ] },
  { title: 'Administração', items: [
    { to: '/notificacoes', label: 'Notificações', icon: BellRing, perm: 'notifications.manage' },
    { to: '/usuarios', label: 'Usuários', icon: Users, perm: 'users.manage' },
    { to: '/auditoria', label: 'Auditoria', icon: ScrollText, perm: 'audit.view' },
  ] },
];

const PAGE_LABELS: Record<string, string> = { '/senha': 'Alterar senha', '/perfil': 'Meu perfil' };

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('slot1.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className={clsx('flex h-16 shrink-0 items-center gap-3', compact ? 'justify-center px-0' : 'px-5')}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-lg shadow-brand-900/40">S1</div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">Slot1 Informática</div>
          <div className="text-xs text-slate-400">Gerência MikroTik</div>
        </div>
      )}
    </div>
  );
}

const isActivePath = (to: string, path: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

export default function Layout() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [fab, setFab] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.perm.split('|').some((p) => can(p))) })).filter((s) => s.items.length),
    [can],
  );
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeItem = [...allItems].sort((a, b) => b.to.length - a.to.length).find((i) => isActivePath(i.to, loc.pathname));
  const currentLabel = PAGE_LABELS[loc.pathname] ?? activeItem?.label ?? 'Slot1';
  const pages = useMemo(() => allItems.map((i) => ({ to: i.to, label: i.label, icon: <i.icon className="size-4" /> })), [allItems]);

  // Página nova começa do topo (a rolagem é a da própria página).
  useEffect(() => {
    setFab(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
      if (e.key === 'Escape') setFab(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('slot1.sidebar', c ? 'expanded' : 'collapsed');
      } catch { /* armazenamento indisponível */ }
      return !c;
    });
  };

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/';
  };

  const me = <Avatar id={user?.id} name={user?.name} version={user?.avatarUpdatedAt} />;

  return (
    <div className="flex min-h-dvh">
      {/* Barra lateral (computador): fixa enquanto a página rola */}
      <aside className={clsx('sticky top-0 hidden h-dvh shrink-0 flex-col bg-slate-950 transition-[width] duration-200 lg:flex', collapsed ? 'w-[72px]' : 'w-64')}>
        <Brand compact={collapsed} />
        <nav className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => (
            <div key={s.title}>
              {!collapsed && <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{s.title}</div>}
              <div className="space-y-0.5">
                {s.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === '/'}
                    title={collapsed ? n.label : undefined}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full bg-brand-500" />}
                        <n.icon className={clsx('size-[18px] shrink-0', isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300')} />
                        {!collapsed && n.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/5 p-3">
          <button
            onClick={toggleCollapsed}
            className={clsx('flex w-full items-center gap-3 rounded-lg py-2 text-xs font-medium text-slate-500 hover:bg-white/[0.04] hover:text-slate-300', collapsed ? 'justify-center' : 'px-3')}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Recolher menu</>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md sm:h-16 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow-md shadow-brand-600/30">S1</div>
            <span className="truncate text-[15px] font-semibold text-slate-900 sm:hidden">{currentLabel}</span>
          </div>
          <button
            onClick={() => setPalette(true)}
            aria-label="Buscar"
            className="order-last flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-300 hover:bg-white sm:order-none sm:h-9 sm:w-auto sm:min-w-0 sm:flex-1 sm:justify-start sm:gap-2.5 sm:rounded-lg sm:px-3 sm:text-sm sm:text-slate-400 md:max-w-md"
          >
            <Search className="size-[18px] shrink-0 sm:size-4" />
            <span className="hidden truncate sm:inline">Buscar equipamento, cliente ou PPPoE…</span>
            <kbd className="ml-auto hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LiveIndicator />
            <div className="relative hidden lg:block" ref={menuRef}>
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1 pr-1.5 hover:bg-slate-100" aria-label="Menu do usuário">
                {me}
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-medium text-slate-800">{user?.name}</span>
                  <span className="block text-xs text-slate-500">{user?.roleLabel}</span>
                </span>
                <ChevronDown className="hidden size-4 text-slate-400 md:block" />
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <div className="truncate text-sm font-medium text-slate-800">{user?.name}</div>
                    <div className="truncate text-xs text-slate-500">{user?.username} · {user?.roleLabel}</div>
                  </div>
                  <button onClick={() => { setMenu(false); nav('/perfil'); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <UserRound className="size-4 text-slate-400" /> Meu perfil
                  </button>
                  <button onClick={() => { setMenu(false); nav('/senha'); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <KeyRound className="size-4 text-slate-400" /> Alterar senha
                  </button>
                  <button onClick={logout} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="size-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {/* overflow-x-clip: corta sobras laterais sem criar outra área de rolagem */}
        <main className="min-w-0 flex-1 overflow-x-clip">
          <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Menu flutuante (celular/tablet): botão redondo no canto inferior direito */}
      <div className="lg:hidden">
        <div
          className={clsx('fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] transition-opacity duration-200', fab ? 'opacity-100' : 'pointer-events-none opacity-0')}
          onClick={() => setFab(false)}
          aria-hidden
        />
        <div
          className={clsx(
            'fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[calc(100dvh-8rem)] w-[min(22rem,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-3xl bg-slate-950 shadow-2xl ring-1 ring-white/10 transition duration-200',
            fab ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
          )}
          role="dialog"
          aria-label="Menu"
          aria-hidden={!fab}
        >
          <button onClick={() => nav('/perfil')} className="flex items-center gap-3 border-b border-white/5 px-4 py-3 text-left active:bg-white/5">
            <Avatar id={user?.id} name={user?.name} version={user?.avatarUpdatedAt} size="md" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium text-white">{user?.name}</span>
              <span className="block truncate text-xs text-slate-400">Meu perfil · {user?.roleLabel}</span>
            </span>
          </button>
          <div className="overflow-y-auto overscroll-contain p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sections.map((s) => (
              <div key={s.title} className="mb-3 last:mb-0">
                <div className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{s.title}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {s.items.map((n) => {
                    const active = isActivePath(n.to, loc.pathname);
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.to === '/'}
                        className={clsx(
                          'flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-center text-[11px] leading-tight font-medium transition active:scale-95',
                          active ? 'bg-brand-600 text-white' : 'bg-white/[0.04] text-slate-300',
                        )}
                      >
                        <n.icon className="size-5" />
                        <span className="line-clamp-2">{n.short ?? n.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-white/5 p-3">
            <button onClick={() => nav('/senha')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/5 text-sm font-medium text-slate-200 active:bg-white/10">
              <KeyRound className="size-4" /> Senha
            </button>
            <button onClick={logout} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500/10 text-sm font-medium text-red-300 active:bg-red-500/20">
              <LogOut className="size-4" /> Sair
            </button>
          </div>
        </div>
        <button
          onClick={() => setFab((f) => !f)}
          aria-label={fab ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={fab}
          className={clsx(
            'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex size-14 items-center justify-center rounded-full text-white shadow-xl shadow-brand-900/30 transition duration-200 active:scale-95',
            fab ? 'rotate-90 bg-slate-900' : 'bg-gradient-to-br from-brand-500 to-brand-700',
          )}
        >
          {fab ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={pages} />
    </div>
  );
}
