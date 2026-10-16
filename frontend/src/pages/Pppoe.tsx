import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building, Network, Router, UserCheck, UserX, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Checkbox, DeviceStatusBadge, Empty, ErrorBox, PageHeader, SearchBox, Skeleton, TimeAgo } from '../components/ui';
import { get } from '../lib/api';

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Icon className="size-3.5" />{label}</div>
      <div className={clsx('mt-0.5 text-lg font-semibold tabular-nums', tone ?? 'text-slate-800')}>{value}</div>
    </div>
  );
}

/** PPPoE: escolha da MikroTik (condomínio) a administrar. */
export default function PppoePage() {
  const q = useQuery({ queryKey: ['ppp', 'devices'], queryFn: () => get('/pppoe/devices') });
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const list = useMemo(() => {
    const t = search.toLowerCase();
    return (q.data ?? []).filter(
      (d: any) =>
        (showAll || d.has_pppoe || !d.collected) &&
        (!t || [d.device_name, d.client_name, d.host, d.identity].join(' ').toLowerCase().includes(t)),
    );
  }, [q.data, search, showAll]);
  const hidden = (q.data ?? []).filter((d: any) => !d.has_pppoe && d.collected).length;
  const totals = useMemo(
    () => (q.data ?? []).reduce((a: any, d: any) => ({ users: a.users + d.secrets_total, online: a.online + d.online, servers: a.servers + (d.has_pppoe ? 1 : 0) }), { users: 0, online: 0, servers: 0 }),
    [q.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="PPPoE"
        subtitle="Selecione a MikroTik do condomínio para administrar os usuários PPPoE dos apartamentos."
        actions={
          q.data && (
            <div className="flex gap-2 text-xs text-slate-500">
              <Badge color="blue">{totals.servers} servidor(es)</Badge>
              <Badge>{totals.users} usuários</Badge>
              <Badge color="green">{totals.online} online</Badge>
            </div>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar condomínio ou MikroTik…" className="w-full sm:w-80" />
        {hidden > 0 && <Checkbox label={`Mostrar MikroTiks sem servidor PPPoE (${hidden})`} checked={showAll} onChange={setShowAll} />}
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-slate-200/80 bg-white"><Empty icon={Network}>Nenhuma MikroTik de cliente com PPPoE encontrada.</Empty></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((d: any) => (
            <Link
              key={d.device_id}
              to={`/pppoe/${d.device_id}`}
              className="group flex flex-col rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building className="size-5" /></div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{d.client_name ?? 'Sem cliente'}</div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-slate-500"><Router className="size-3.5" />{d.device_name} · <span className="mono">{d.host}</span></div>
                  </div>
                </div>
                <DeviceStatusBadge status={d.device_status} title={d.status_message} />
              </div>

              {d.has_pppoe ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Metric icon={Users} label="Usuários" value={d.secrets_total} />
                  <Metric icon={UserCheck} label="Online" value={d.online} tone="text-emerald-700" />
                  <Metric icon={UserX} label="Desabilitados" value={d.secrets_disabled} tone={d.secrets_disabled ? 'text-red-700' : undefined} />
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                  {d.collected ? 'Nenhum servidor PPPoE ou usuário nesta MikroTik.' : d.device_status === 'online' || d.device_status === 'unknown' ? 'Aguardando a primeira coleta.' : 'A MikroTik ainda não respondeu — sem dados de PPPoE.'}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {d.stale ? <AlertTriangle className="size-3.5 shrink-0 text-amber-500" /> : null}
                  {d.servers.length ? `Servidor em ${d.servers.join(', ')}` : 'Dados da coleta'} · <TimeAgo date={d.collectedAt} never="sem coleta" />
                </span>
                <span className="flex items-center gap-1 font-medium text-brand-700 opacity-0 transition group-hover:opacity-100">Gerenciar <ArrowRight className="size-3.5" /></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
