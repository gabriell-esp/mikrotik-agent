import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BellRing, Building2, ChevronDown, ChevronsLeft, ChevronsRight, KeyRound, LayoutDashboard, LogOut, Menu, Network, Router, ScrollText, Search,
  Users, Waypoints, Wifi, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommandPalette from './CommandPalette';
import LiveIndicator from './LiveIndicator';

interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; perm: string }

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Monitoramento', items: [
    { to: '/', label: 'Dashboard', short: 'Início', icon: LayoutDashboard, perm: 'dashboard.view' },
    { to: '/wireguard', label: 'WireGuard', icon: Waypoints, perm: 'wireguard.view' },
    { to: '/equipamentos', label: 'Equipamentos', short: 'Equip.', icon: Router, perm: 'devices.view' },
    { to: '/unifi', label: 'UniFi', icon: Wifi, perm: 'unifi.view' },
  ] },
  { title: 'Atendimento', items: [
    { to: '/pppoe', label: 'PPPoE', icon: Network, perm: 'pppoe.view' },
    { to: '/clientes', label: 'Clientes', icon: Building2, perm: 'clients.view' },
  ] },
  { title: 'Administração', items: [
    { to: '/notificacoes', label: 'Notificações', icon: BellRing, perm: 'notifications.manage' },
    { to: '/usuarios', label: 'Usuários', icon: Users, perm: 'users.manage' },
    { to: '/auditoria', label: 'Auditoria', icon: ScrollText, perm: 'audit.view' },
  ] },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('slot1.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className={clsx('flex h-16 items-center gap-3', compact ? 'justify-center px-0' : 'px-5')}>
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

export default function Layout() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => can(i.perm)) })).filter((s) => s.items.length),
    [can],
  );
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const bottomItems = useMemo(() => {
    const prefer = ['/', '/equipamentos', '/pppoe', '/unifi', '/wireguard'];
    return prefer.map((to) => allItems.find((i) => i.to === to)).filter(Boolean).slice(0, 4) as NavItem[];
  }, [allItems]);
  const activeItem = [...allItems].sort((a, b) => b.to.length - a.to.length).find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));
  const moreActive = !!activeItem && !bottomItems.includes(activeItem);
  const currentLabel = loc.pathname === '/senha' ? 'Alterar senha' : activeItem?.label ?? 'Slot1';
  const pages = useMemo(() => sections.flatMap((s) => s.items).map((i) => ({ to: i.to, label: i.label, icon: <i.icon className="size-4" /> })), [sections]);

  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
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

  const navList = (compact: boolean) => (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((s) => (
        <div key={s.title}>
          {!compact && <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{s.title}</div>}
          <div className="space-y-0.5">
            {s.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                title={compact ? n.label : undefined}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                    compact ? 'justify-center px-0' : 'px-3',
                    isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full bg-brand-500" />}
                    <n.icon className={clsx('size-[18px] shrink-0', isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300')} />
                    {!compact && n.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      {/* Barra lateral (desktop) */}
      <aside className={clsx('hidden shrink-0 flex-col bg-slate-950 transition-[width] duration-200 lg:flex', collapsed ? 'w-[72px]' : 'w-64')}>
        <Brand compact={collapsed} />
        {navList(collapsed)}
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

      {/* Menu completo (celular) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-slate-950 pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
            <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold text-white">{initials(user?.name)}</span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-medium text-white">{user?.name}</div>
                  <div className="truncate text-xs text-slate-400">{user?.username} · {user?.roleLabel}</div>
                </div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="flex size-10 items-center justify-center rounded-full bg-white/5 text-slate-300" aria-label="Fechar menu"><X className="size-5" /></button>
            </div>
            <div className="overflow-y-auto overscroll-contain">{navList(false)}</div>
            <div className="grid grid-cols-2 gap-2 border-t border-white/5 p-3">
              <button onClick={() => { setMobileOpen(false); nav('/senha'); }} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/5 text-sm font-medium text-slate-200 active:bg-white/10">
                <KeyRound className="size-4" /> Alterar senha
              </button>
              <button onClick={logout} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-500/10 text-sm font-medium text-red-300 active:bg-red-500/20">
                <LogOut className="size-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}

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
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-semibold text-white">{initials(user?.name)}</span>
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
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:p-8">
            <Outlet />
          </div>
        </main>

        {/* Navegação inferior (celular/tablet) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-lg items-stretch justify-around px-1">
            {bottomItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) => clsx('flex min-w-0 flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors', isActive ? 'text-brand-600' : 'text-slate-500')}
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-brand-50')}>
                      <n.icon className="size-5" strokeWidth={isActive ? 2.25 : 1.75} />
                    </span>
                    <span className="truncate">{n.short ?? n.label}</span>
                  </>
                )}
              </NavLink>
            ))}
            <button onClick={() => setMobileOpen(true)} className={clsx('flex min-w-0 flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium', moreActive ? 'text-brand-600' : 'text-slate-500')}>
              <span className={clsx('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-brand-50')}><Menu className="size-5" /></span>
              Menu
            </button>
          </div>
        </nav>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={pages} />
    </div>
  );
}
