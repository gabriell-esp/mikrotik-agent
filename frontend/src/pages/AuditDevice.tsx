import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ExternalLink, Router } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import AuditLog from '../components/AuditLog';
import { DeviceStatusBadge, ErrorBox, PageHeader, PageSkeleton } from '../components/ui';
import { get } from '../lib/api';

const crumb = (label: string) => (
  <span className="flex items-center gap-1"><Link to="/auditoria" className="hover:text-brand-700">Auditoria</Link><ChevronRight className="size-3" />{label}</span>
);

/** Histórico de auditoria de um equipamento, do sistema ou de equipamentos removidos. */
export default function AuditDevicePage() {
  const { key } = useParams();
  const deviceId = /^\d+$/.test(key ?? '') ? Number(key) : undefined;
  const dev = useQuery({ queryKey: ['device', deviceId], queryFn: () => get(`/devices/${deviceId}`), enabled: !!deviceId });

  if (key === 'sistema' || key === 'removidos') {
    const system = key === 'sistema';
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumb={crumb(system ? 'Sistema' : 'Equipamentos removidos')}
          title={system ? 'Auditoria do sistema' : 'Equipamentos removidos'}
          subtitle={system ? 'Logins, usuários, clientes e notificações — eventos que não pertencem a um equipamento.' : 'Histórico preservado de equipamentos que foram excluídos do cadastro.'}
        />
        <AuditLog scope={system ? 'system' : 'removed'} showDevice={!system} />
      </div>
    );
  }
  if (!deviceId) return <ErrorBox error={new Error('Equipamento inválido.')} />;
  if (dev.isLoading) return <PageSkeleton />;
  if (dev.error) return <ErrorBox error={dev.error} />;
  const d = dev.data;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={crumb(d.client_name ?? d.name)}
        title={d.client_name ?? d.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5"><Router className="size-4" />{d.name}</span>
            <span className="mono">{d.host}</span>
            <DeviceStatusBadge status={d.status} />
          </span>
        }
        actions={<Link to={`/equipamentos/${d.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"><ExternalLink className="size-4" /> Ver equipamento</Link>}
      />
      <AuditLog deviceId={d.id} />
    </div>
  );
}
