import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Archive, Eye, Router, Settings2, ShieldAlert, Wifi, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { actionLabel } from '../components/AuditLog';
import { Badge, Checkbox, DeviceStatusBadge, Empty, ErrorBox, PageHeader, SearchBox, Skeleton, TimeAgo } from '../components/ui';
import { get } from '../lib/api';

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={clsx('mt-0.5 text-lg font-semibold tabular-nums', tone ?? 'text-slate-800')}>{value}</div>
    </div>
  );
}

function AuditCard({ to, icon: Icon, iconTone, title, subtitle, badge, s }: {
  to: string; icon: LucideIcon; iconTone: string; title: ReactNode; subtitle: ReactNode; badge?: ReactNode; s: any;
}) {
  return (
    <Link to={to} className="group flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition hover:border-brand-300 hover:shadow-md active:scale-[0.99] sm:rounded-xl sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl', iconTone)}><Icon className="size-5" /></div>
          <div className="min-w-0">
            <div className="line-clamp-2 font-semibold leading-snug text-slate-900 sm:truncate">{title}</div>
            <div className="truncate text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>
        {badge}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Registros" value={s.total} />
        <Metric label="Últimos 7 dias" value={s.last_7d} tone="text-brand-700" />
        <Metric label="Falhas" value={s.failures} tone={s.failures ? 'text-red-700' : undefined} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span className="min-w-0 truncate">
          {s.last ? <>Último: <b className="font-medium text-slate-700">{actionLabel(s.last.action)}</b> por {s.last.username ?? '—'} · <TimeAgo date={s.last.at} /></> : 'Nenhum registro'}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {s.sensitive > 0 && <span className="flex items-center gap-1 text-amber-700" title="Visualizações de senha PPPoE"><Eye className="size-3.5" />{s.sensitive}</span>}
          <ArrowRight className="size-3.5 text-brand-600 opacity-0 transition group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}

/** Auditoria: escolha do equipamento (ou eventos do sistema) para ver o histórico. */
export default function AuditPage() {
  const q = useQuery({ queryKey: ['audit-devices'], queryFn: () => get('/audit/devices') });
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  const list = useMemo(() => {
    const t = search.toLowerCase();
    return (q.data?.devices ?? []).filter(
      (d: any) => (!onlyActive || d.total > 0) && (!t || [d.device_name, d.client_name, d.host].join(' ').toLowerCase().includes(t)),
    );
  }, [q.data, search, onlyActive]);

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoria" subtitle="Histórico de alterações e consultas sensíveis, separado por equipamento." />
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <AuditCard to="/auditoria/sistema" icon={Settings2} iconTone="bg-slate-100 text-slate-600" title="Sistema" subtitle="Logins, usuários, clientes e notificações" s={q.data.system} />
            {q.data.removed.total > 0 && (
              <AuditCard to="/auditoria/removidos" icon={Archive} iconTone="bg-red-50 text-red-600" title="Equipamentos removidos"
                subtitle={`Histórico preservado de ${q.data.removed.devices} equipamento(s) excluído(s)`} s={q.data.removed} />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ShieldAlert className="size-4 text-slate-400" /> Equipamentos ({list.length})</h2>
            <div className="flex flex-wrap items-center gap-4">
              <Checkbox label="Somente com registros" checked={onlyActive} onChange={setOnlyActive} />
              <SearchBox value={search} onChange={setSearch} placeholder="Buscar cliente ou equipamento…" className="w-full sm:w-72" />
            </div>
          </div>

          {(q.data.controllers?.length ?? 0) > 0 && (
            <>
              <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold text-slate-700"><Wifi className="size-4 text-slate-400" /> Controladoras UniFi ({q.data.controllers.length})</h2>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {q.data.controllers
                  .filter((c: any) => (!onlyActive || c.total > 0) && (!search || [c.device_name, c.client_name, c.host].join(' ').toLowerCase().includes(search.toLowerCase())))
                  .map((c: any) => (
                    <AuditCard
                      key={`u${c.controller_id}`}
                      to={`/auditoria/unifi-${c.controller_id}`}
                      icon={Wifi}
                      iconTone="bg-sky-50 text-sky-600"
                      title={c.client_name ?? c.device_name}
                      subtitle={<>{c.client_name ? `${c.device_name} · ` : ''}<span className="mono">{String(c.host).replace(/^https?:\/\//, '')}</span></>}
                      badge={<DeviceStatusBadge status={c.status} />}
                      s={c}
                    />
                  ))}
              </div>
            </>
          )}

          {list.length === 0 ? (
            <div className="rounded-xl border border-slate-200/80 bg-white"><Empty>Nenhum equipamento encontrado.</Empty></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {list.map((d: any) => (
                <AuditCard
                  key={d.device_id}
                  to={`/auditoria/${d.device_id}`}
                  icon={Router}
                  iconTone={d.is_central ? 'bg-violet-50 text-violet-600' : 'bg-brand-50 text-brand-600'}
                  title={d.client_name ?? d.device_name}
                  subtitle={<>{d.client_name ? `${d.device_name} · ` : ''}<span className="mono">{d.host}</span></>}
                  badge={d.is_central ? <Badge color="purple">central</Badge> : <DeviceStatusBadge status={d.status} />}
                  s={d}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
