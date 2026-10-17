import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DeviceForm, { type DeviceFormInitial } from '../components/DeviceForm';
import DeviceList from '../components/DeviceList';
import { Button, Card, Empty, ErrorBox, PageHeader, Pagination, SearchBox, Select, TableSkeleton, usePaged } from '../components/ui';
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
      <PageHeader
        title="Equipamentos"
        subtitle={devices.data && `${devices.data.length} cadastrado(s)`}
        actions={can('devices.manage') && <Button variant="primary" className="w-full sm:w-auto" onClick={() => setCreating({})}><Plus className="size-4" /> Cadastrar equipamento</Button>}
      />
      <Card
        bodyClass=""
        title={`${rows.length} equipamento(s)`}
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Nome, IP, modelo, versão…" className="w-full sm:w-60" />
            {can('clients.view') && (
              <Select value={client} onChange={(e) => setParams(e.target.value ? { cliente: e.target.value } : {})} className="w-[calc(50%-0.25rem)] sm:w-48">
                <option value="">Cliente: todos</option>
                {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-48">
              <option value="">Status: todos</option>
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
          <>
            <DeviceList rows={paged.slice} showModel />
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </Card>
      <DeviceForm open={!!creating} initial={creating} onClose={() => setCreating(undefined)} />
    </div>
  );
}
