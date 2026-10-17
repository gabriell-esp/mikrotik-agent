import { useNavigate } from 'react-router-dom';
import DataList, { type Col } from './DataList';
import { Badge, DeviceStatusBadge, PeerStateBadge, TimeAgo } from './ui';

const ACCENT: Record<string, 'green' | 'red' | 'amber' | 'slate'> = {
  online: 'green', unreachable: 'red', auth_failed: 'amber', error: 'amber', unknown: 'slate',
};

/** Lista de equipamentos: tabela no computador, cards no celular. */
export default function DeviceList({ rows, showModel }: { rows: any[]; showModel?: boolean }) {
  const nav = useNavigate();
  const cols: Col<any>[] = [
    {
      key: 'name',
      header: 'Equipamento',
      mobile: 'title',
      cell: (d) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{d.name}</span>
          {d.is_central && <Badge color="purple">central</Badge>}
          <div className="mono hidden w-full md:block">{d.host}{d.identity ? ` · ${d.identity}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      mobile: 'subtitle',
      cell: (d) => (
        <>
          {d.client_name ?? <span className="text-slate-400">{d.is_central ? 'Slot1' : '—'}</span>}
          <span className="mono md:hidden"> · {d.host}</span>
        </>
      ),
    },
    { key: 'status', header: 'Gerência', mobile: 'badges', cell: (d) => <DeviceStatusBadge status={d.status} title={d.status_message} /> },
    { key: 'peer', header: 'Túnel WireGuard', mobile: 'badges', cell: (d) => (d.peer_state || !d.is_central ? <PeerStateBadge state={d.peer_state} /> : null) },
    ...(showModel
      ? [{ key: 'model', header: 'Modelo', cell: (d: any) => <span className="text-xs">{d.board_name ?? '—'}</span> } as Col<any>]
      : []),
    { key: 'version', header: 'Versão', cell: (d) => <span className="text-xs text-slate-500">{d.ros_version?.replace(' (stable)', '') ?? '—'}</span> },
    { key: 'last', header: 'Última resposta', label: 'Respondeu', cell: (d) => <span className="whitespace-nowrap text-xs text-slate-500"><TimeAgo date={d.last_ok_at} /></span> },
  ];
  return (
    <DataList
      rows={rows}
      cols={cols}
      rowKey={(d) => d.id}
      onRowClick={(d) => nav(`/equipamentos/${d.id}`)}
      accent={(d) => ACCENT[d.status] ?? 'slate'}
    />
  );
}
