import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Plus, Server, Wifi } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import UnifiForm, { type UnifiInitial } from '../components/UnifiForm';
import { Badge, Button, DeviceStatusBadge, Empty, ErrorBox, PageHeader, SearchBox, Skeleton, TimeAgo } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2 text-center sm:text-left">
      <div className={clsx('text-lg leading-tight font-semibold tabular-nums', tone ?? 'text-slate-800')}>{value}</div>
      <div className="truncate text-[11px] font-medium text-slate-500">{label}</div>
    </div>
  );
}

const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
};

/** Controladoras UniFi (Cloud Keys) dos clientes. */
export default function UnifiPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['unifi', 'controllers'], queryFn: () => get('/unifi/controllers') });
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<UnifiInitial | undefined>();

  const list = useMemo(() => {
    const t = search.toLowerCase();
    return (q.data ?? []).filter((c: any) => !t || [c.name, c.client_name, c.url, c.version].join(' ').toLowerCase().includes(t));
  }, [q.data, search]);
  const totals = useMemo(
    () => (q.data ?? []).reduce((a: any, c: any) => ({ aps: a.aps + c.summary.aps, off: a.off + c.summary.offline, cl: a.cl + c.summary.clients }), { aps: 0, off: 0, cl: 0 }),
    [q.data],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="UniFi"
        subtitle="Controladoras dos clientes: antenas, clientes Wi-Fi e redes."
        actions={can('unifi.manage') && <Button variant="primary" className="w-full sm:w-auto" onClick={() => setCreating({})}><Plus className="size-4" /> Cadastrar controladora</Button>}
      />
      {q.data && q.data.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge color="blue">{q.data.length} controladora(s)</Badge>
          <Badge>{totals.aps} antenas</Badge>
          {totals.off > 0 && <Badge color="red" dot>{totals.off} desconectada(s)</Badge>}
          <Badge color="green">{totals.cl} clientes conectados</Badge>
        </div>
      )}
      {q.data && q.data.length > 3 && <SearchBox value={search} onChange={setSearch} placeholder="Buscar condomínio ou controladora…" className="w-full sm:w-80" />}

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white">
          <Empty icon={Wifi}>{q.data?.length ? 'Nada encontrado.' : 'Nenhuma controladora cadastrada ainda.'}</Empty>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((c: any) => (
            <Link
              key={c.id}
              to={`/unifi/${c.id}`}
              className="group flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition hover:border-brand-300 hover:shadow-md active:scale-[0.99] sm:rounded-xl sm:p-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Wifi className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="line-clamp-2 min-w-0 font-semibold leading-snug break-words text-slate-900">{c.client_name ?? c.name}</div>
                    <span className="hidden shrink-0 sm:block"><DeviceStatusBadge status={c.status} title={c.status_message} /></span>
                  </div>
                  <div className="mt-1 sm:hidden"><DeviceStatusBadge status={c.status} title={c.status_message} /></div>
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                    <Server className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{c.name}{c.version ? ` · Network ${c.version}` : ''}</span>
                  </div>
                  <div className="mono mt-0.5 truncate pl-5 text-slate-400">{host(c.url)}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Metric label="Antenas" value={c.summary.devices ? `${c.summary.online}/${c.summary.devices}` : '—'} tone={c.summary.offline ? 'text-amber-700' : 'text-emerald-700'} />
                <Metric label="Clientes" value={c.summary.clients} />
                <Metric label="Atualizar" value={c.summary.upgradable} tone={c.summary.upgradable ? 'text-brand-700' : undefined} />
              </div>
              {c.status !== 'online' && c.status_message && (
                <div className="mt-3 line-clamp-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{c.status_message}</div>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {c.sync?.stale && <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />}
                  {c.summary.sites} site(s) · leitura <TimeAgo date={c.sync?.collectedAt} never="pendente" />
                </span>
                <ArrowRight className="size-4 shrink-0 text-brand-600 sm:opacity-0 sm:transition sm:group-hover:opacity-100" />
              </div>
            </Link>
          ))}
        </div>
      )}
      <UnifiForm open={!!creating} initial={creating} onClose={() => setCreating(undefined)} />
    </div>
  );
}
