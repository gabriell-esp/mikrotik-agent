import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ExternalLink, Router, UserCheck, Users, UserX, WifiOff } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DeviceStatusBadge, ErrorBox, Notice, PageHeader, PageSkeleton, StatCard, TimeAgo, deviceStatusLabel } from '../components/ui';
import { get } from '../lib/api';
import { PppTab } from './DeviceDetail';

/** Administração PPPoE de uma MikroTik de condomínio. */
export default function PppoeDevicePage() {
  const { id } = useParams();
  const deviceId = Number(id);
  const [params] = useSearchParams();
  const dev = useQuery({ queryKey: ['device', deviceId], queryFn: () => get(`/devices/${deviceId}`) });
  const summary = useQuery({ queryKey: ['ppp', 'devices'], queryFn: () => get('/pppoe/devices') });

  if (dev.isLoading) return <PageSkeleton />;
  if (dev.error) return <ErrorBox error={dev.error} />;
  const d = dev.data;
  if (d.is_central) return <Notice>A MikroTik central não é gerenciada como servidor PPPoE. Escolha a MikroTik de um condomínio em <Link className="font-medium underline" to="/pppoe">PPPoE</Link>.</Notice>;
  const s = summary.data?.find((x: any) => x.device_id === deviceId);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<span className="flex items-center gap-1"><Link to="/pppoe" className="hover:text-brand-700">PPPoE</Link><ChevronRight className="size-3" />{d.client_name ?? 'Sem cliente'}</span>}
        title={d.client_name ?? d.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5"><Router className="size-4" />{d.name}</span>
            <span className="mono">{d.host}</span>
            {d.ros_version && <span>RouterOS {d.ros_version}</span>}
            <DeviceStatusBadge status={d.status} title={d.status_message} />
          </span>
        }
        actions={<Link to={`/equipamentos/${d.id}`} className="inline-flex h-11 w-full items-center justify-center sm:h-9 sm:w-auto gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"><ExternalLink className="size-4" /> Ver equipamento</Link>}
      />

      {d.status !== 'online' && d.status !== 'unknown' && (
        <Notice>
          MikroTik {deviceStatusLabel(d.status).toLowerCase()}: a lista mostra a última coleta (<TimeAgo date={s?.collectedAt} never="sem coleta" />) e alterações não podem ser feitas até ela voltar a responder.
        </Notice>
      )}

      {s && (
        <div className="grid grid-cols-4 divide-x divide-slate-100 rounded-2xl border border-slate-200/80 bg-white py-3 shadow-xs sm:hidden">
          {[
            { l: 'Usuários', v: s.secrets_total, c: 'text-slate-900' },
            { l: 'Online', v: s.online, c: 'text-emerald-600' },
            { l: 'Offline', v: s.offline, c: s.offline ? 'text-amber-600' : 'text-slate-900' },
            { l: 'Bloqueados', v: s.secrets_disabled, c: s.secrets_disabled ? 'text-red-600' : 'text-slate-900' },
          ].map((m) => (
            <div key={m.l} className="text-center">
              <div className={`text-xl font-semibold tabular-nums ${m.c}`}>{m.v}</div>
              <div className="text-[11px] text-slate-500">{m.l}</div>
            </div>
          ))}
        </div>
      )}

      {s && (
        <div className="hidden grid-cols-2 gap-4 sm:grid lg:grid-cols-4">
          <StatCard label="Usuários cadastrados" value={s.secrets_total} icon={Users} tone="blue" foot={s.servers.length ? `Servidor PPPoE em ${s.servers.join(', ')}` : 'Nenhum servidor PPPoE ativo'} />
          <StatCard label="Online agora" value={s.online} icon={UserCheck} tone="green" foot="sessões ativas" />
          <StatCard label="Habilitados offline" value={s.offline} icon={WifiOff} tone={s.offline ? 'amber' : 'slate'} foot="sem sessão no momento" />
          <StatCard label="Desabilitados" value={s.secrets_disabled} icon={UserX} tone={s.secrets_disabled ? 'red' : 'slate'} foot="bloqueados no equipamento" />
        </div>
      )}

      <PppTab deviceId={deviceId} initialSearch={params.get('busca') ?? ''} />
    </div>
  );
}
