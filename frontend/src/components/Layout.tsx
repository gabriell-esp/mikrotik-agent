import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BellRing, Building2, ChevronDown, ChevronsLeft, ChevronsRight, KeyRound, LayoutDashboard, LogOut, Menu, Network, Router, ScrollText, Search,
  Users, Waypoints, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommandPalette from './CommandPalette';
import LiveIndicator from './LiveIndicator';

interface NavItem { to: string; label: string; icon: LucideIcon; perm: string }

const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Monitoramento', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
    { to: '/wireguard', label: 'WireGuard', icon: Waypoints, perm: 'wireguard.view' },
    { to: '/equipamentos', label: 'Equipamentos', icon: Router, perm: 'devices.view' },
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

      {/* Barra lateral (celular) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5" aria-label="Fechar menu"><X className="size-5" /></button>
            </div>
            {navList(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition hover:border-slate-300 hover:bg-white sm:max-w-md"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">Buscar equipamento, cliente ou PPPoE…</span>
            <kbd className="ml-auto hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LiveIndicator />
            <div className="relative" ref={menuRef}>
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
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={pages} />
    </div>
  );
}
