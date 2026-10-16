import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, CornerDownLeft, Network, Router, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DeviceStatusBadge } from './ui';

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  to: string;
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Busca global (Ctrl+K): equipamentos, clientes e usuários PPPoE. */
export default function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: { to: string; label: string; icon: ReactNode }[] }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useDebounced(term.trim());

  useEffect(() => {
    if (open) {
      setTerm('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get('/devices'), enabled: open && can('devices.view') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open && can('clients.view') });
  const ppp = useQuery({
    queryKey: ['palette-ppp', t],
    queryFn: () => get('/pppoe/secrets', { search: t, page_size: 10 }),
    enabled: open && t.length >= 2 && can('pppoe.view'),
    meta: { live: false },
  });

  const items = useMemo<Item[]>(() => {
    const low = t.toLowerCase();
    const out: Item[] = [];
    if (!low) {
      pages.forEach((p) => out.push({ key: `p${p.to}`, group: 'Ir para', icon: p.icon, title: p.label, to: p.to }));
      return out;
    }
    pages.filter((p) => p.label.toLowerCase().includes(low)).forEach((p) => out.push({ key: `p${p.to}`, group: 'Ir para', icon: p.icon, title: p.label, to: p.to }));
    (devices.data ?? [])
      .filter((d: any) => [d.name, d.host, d.identity, d.client_name].join(' ').toLowerCase().includes(low))
      .slice(0, 8)
      .forEach((d: any) => out.push({
        key: `d${d.id}`, group: 'Equipamentos', icon: <Router className="size-4" />, title: d.name,
        subtitle: [d.client_name, d.host].filter(Boolean).join(' · '), extra: <DeviceStatusBadge status={d.status} />, to: `/equipamentos/${d.id}`,
      }));
    (clients.data ?? [])
      .filter((c: any) => [c.name, c.document, c.contact].join(' ').toLowerCase().includes(low))
      .slice(0, 5)
      .forEach((c: any) => out.push({ key: `c${c.id}`, group: 'Clientes', icon: <Building2 className="size-4" />, title: c.name, subtitle: `${c.devices} equipamento(s)`, to: `/equipamentos?cliente=${c.id}` }));
    (ppp.data?.rows ?? []).forEach((s: any) => out.push({
      key: `s${s.device_id}:${s.id}`, group: 'Usuários PPPoE', icon: <Network className="size-4" />, title: s.name,
      subtitle: [s.comment, s.device_name, s.client_name].filter(Boolean).join(' · '), to: `/pppoe/${s.device_id}?busca=${encodeURIComponent(s.name)}`,
    }));
    return out;
  }, [t, pages, devices.data, clients.data, ppp.data]);

  useEffect(() => setActive(0), [t]);

  const go = (i: Item) => {
    onClose();
    nav(i.to);
  };

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="size-4 text-slate-400" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar equipamento, cliente ou usuário PPPoE…"
            className="h-13 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && items[active]) go(items[active]);
            }}
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">ESC</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-500">{ppp.isLoading && t.length >= 2 ? 'Buscando…' : 'Nada encontrado.'}</div>
          ) : (
            items.map((it, i) => {
              const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
              return (
                <div key={it.key}>
                  {header && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{header}</div>}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(it)}
                    className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700')}
                  >
                    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', i === active ? 'bg-white text-brand-600' : 'bg-slate-100 text-slate-500')}>{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{it.title}</span>
                      {it.subtitle && <span className="block truncate text-xs text-slate-500">{it.subtitle}</span>}
                    </span>
                    {it.extra}
                    {i === active && <CornerDownLeft className="size-3.5 text-slate-400" />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
