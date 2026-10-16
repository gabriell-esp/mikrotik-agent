import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DeviceForm, { type DeviceFormInitial } from '../components/DeviceForm';
import { Badge, Button, Card, DeviceStatusBadge, Empty, ErrorBox, PageHeader, Pagination, PeerStateBadge, SearchBox, Select, TableSkeleton, TimeAgo, usePaged } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function DevicesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get('/devices') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: can('clients.view') });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState<DeviceFormInitial | undefined>();
  const client = params.get('cliente') ?? '';

  const rows = useMemo(() => {
    const t = search.toLowerCase();
    return (devices.data ?? []).filter((d: any) =>
      (!status || d.status === status) && (!client || String(d.client_id) === client) &&
      (!t || [d.name, d.host, d.client_name, d.identity, d.board_name, d.ros_version].join(' ').toLowerCase().includes(t)),
    );
  }, [devices.data, search, status, client]);
  const paged = usePaged(rows, 25);

  return (
    <div className="space-y-4">
      <PageHeader title="Equipamentos" actions={can('devices.manage') && <Button variant="primary" onClick={() => setCreating({})}><Plus className="size-4" /> Cadastrar equipamento</Button>} />
      <Card
        bodyClass=""
        title={`${rows.length} equipamentos`}
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Nome, IP, modelo, versão…" className="w-full sm:w-60" />
            {can('clients.view') && (
              <Select value={client} onChange={(e) => setParams(e.target.value ? { cliente: e.target.value } : {})} className="w-full sm:w-48">
                <option value="">Todos os clientes</option>
                {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
              <option value="">Todos os status</option>
              <option value="online">Gerenciável</option>
              <option value="unreachable">Inacessível</option>
              <option value="auth_failed">Falha de autenticação</option>
              <option value="error">Erro de comunicação</option>
              <option value="unknown">Não verificado</option>
            </Select>
          </>
        }
      >
        {devices.isLoading ? <TableSkeleton /> : devices.error ? <div className="p-4"><ErrorBox error={devices.error} /></div> : rows.length === 0 ? <Empty>Nenhum equipamento.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Equipamento</th><th>Cliente</th><th>Modelo / versão</th><th>Acesso</th><th>Gerência</th><th>Túnel</th><th>Última resposta</th></tr></thead>
              <tbody>
                {paged.slice.map((d: any) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/equipamentos/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.name}</Link>{' '}
                      {d.is_central && <Badge color="purple">central</Badge>}
                      <div className="mono text-slate-500">{d.host}{d.identity ? ` · ${d.identity}` : ''}</div>
                    </td>
                    <td>{d.client_name ?? '—'}</td>
                    <td className="text-xs">{d.board_name ?? '—'}<div className="text-slate-500">{d.ros_version ?? 'versão não coletada'}</div></td>
                    <td className="text-xs">{d.detected_method ?? d.api_method}</td>
                    <td><DeviceStatusBadge status={d.status} title={d.status_message} /></td>
                    <td><PeerStateBadge state={d.peer_state} /></td>
                    <td className="text-xs text-slate-500"><TimeAgo date={d.last_ok_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </div>
        )}
      </Card>
      <DeviceForm open={!!creating} initial={creating} onClose={() => setCreating(undefined)} />
    </div>
  );
}
