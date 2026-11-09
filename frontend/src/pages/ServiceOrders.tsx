import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarClock, Camera, ClipboardList, Clock, MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Crew } from '../components/Avatar';
import DataList from '../components/DataList';
import ServiceOrderForm from '../components/ServiceOrderForm';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pagination, SearchBox, Select, TableSkeleton, Tabs, usePaged } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { fmtClock, fmtMoney, OS_PRIORITY, OS_STATUS, osNumber, useWorkSeconds } from '../lib/os';

const TABS = [
  { key: 'ativas', label: 'Em aberto', count: (c: any) => (c.aberta ?? 0) + (c.em_andamento ?? 0) + (c.pausada ?? 0) },
  { key: 'em_andamento', label: 'Em andamento', count: (c: any) => c.em_andamento ?? 0 },
  { key: 'concluida', label: 'Concluídas', count: (c: any) => c.concluida ?? 0 },
  { key: 'cancelada', label: 'Canceladas', count: (c: any) => c.cancelada ?? 0 },
  { key: 'todas', label: 'Todas', count: (c: any) => Object.values(c).reduce((a: number, b: any) => a + b, 0) },
];

export function OsStatusBadge({ status }: { status: string }) {
  const s = OS_STATUS[status] ?? OS_STATUS.aberta!;
  return <Badge color={s.color} dot>{s.label}</Badge>;
}

function WorkTime({ o }: { o: any }) {
  const sec = useWorkSeconds(o);
  if (!sec && !o.running_since) return <span className="text-slate-300">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${o.running_since ? 'font-semibold text-brand-700' : 'text-slate-600'}`}>
      <Clock className="size-3.5" />
      {fmtClock(sec)}
    </span>
  );
}

export default function ServiceOrdersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('aba') ?? 'ativas';
  const assigned = params.get('tecnico') ?? '';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const seesAll = can('os.view_all') || can('os.manage');
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const list = useQuery({
    queryKey: ['os', 'list', status, assigned, search],
    queryFn: () => get('/os', { status, assigned: assigned && assigned !== 'eu' ? assigned : undefined, mine: assigned === 'eu' ? 1 : undefined, q: search || undefined }),
    placeholderData: keepPreviousData,
  });
  const assignees = useQuery({ queryKey: ['os', 'assignees'], queryFn: () => get('/os/assignees'), enabled: can('os.manage') });
  const rows: any[] = list.data?.rows ?? [];
  const paged = usePaged(rows, 30);
  const counts = list.data?.counts ?? {};

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ordens de serviço"
        subtitle={seesAll ? 'Atendimentos abertos, em execução e concluídos.' : 'Ordens atribuídas a você.'}
        actions={can('os.manage') && <Button variant="primary" className="w-full sm:w-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> Nova ordem</Button>}
      />

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: <>{t.label}{list.data && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{t.count(counts)}</span>}</> }))}
        active={status}
        onChange={(k) => setParam('aba', k === 'ativas' ? '' : k)}
      />

      <Card
        bodyClass=""
        title={`${rows.length} ordem(ns)`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {seesAll && (
              <Select value={assigned} onChange={(e) => setParam('tecnico', e.target.value)} className="sm:w-48">
                <option value="">Todos os técnicos</option>
                {can('os.execute') && <option value="eu">Atribuídas a mim</option>}
                {(assignees.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
            <SearchBox value={search} onChange={setSearch} placeholder="Nº, título, cliente, local…" className="w-full sm:w-64" />
          </div>
        }
      >
        {list.isLoading ? <TableSkeleton cols={6} /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !rows.length ? (
          <Empty icon={ClipboardList}>{status === 'ativas' ? (seesAll ? 'Nenhuma ordem em aberto.' : 'Você não tem ordens em aberto.') : 'Nenhuma ordem encontrada.'}</Empty>
        ) : (
          <>
            <DataList
              rows={paged.slice}
              rowKey={(o: any) => o.id}
              onRowClick={(o: any) => nav(`/os/${o.id}`)}
              accent={(o: any) => OS_STATUS[o.status]?.accent}
              cols={[
                {
                  key: 'title', header: 'Ordem', mobile: 'title', td: 'min-w-[15rem]',
                  cell: (o: any) => (
                    <div className="min-w-0">
                      <span className="block text-xs font-medium whitespace-nowrap text-slate-500 tabular-nums">{osNumber(o.id)}</span>
                      <span className="font-medium text-slate-900">{o.title}</span>
                    </div>
                  ),
                },
                {
                  key: 'client', header: 'Cliente / local', mobile: 'subtitle', td: 'min-w-[11rem]',
                  cell: (o: any) => (
                    <span className="text-sm">
                      {o.client_name ?? '—'}
                      {o.location && <span className="inline-flex items-center gap-0.5 text-xs text-slate-500 max-md:before:content-['_·_'] md:flex"><MapPin className="size-3 max-md:hidden" />{o.location}</span>}
                    </span>
                  ),
                },
                {
                  key: 'status', header: 'Situação', mobile: 'badges',
                  cell: (o: any) => (
                    <div className="flex flex-wrap gap-1">
                      <OsStatusBadge status={o.status} />
                      {['alta', 'urgente'].includes(o.priority) && <Badge color={OS_PRIORITY[o.priority]!.color}>{OS_PRIORITY[o.priority]!.label}</Badge>}
                    </div>
                  ),
                },
                {
                  key: 'assigned', header: 'Técnicos', td: 'whitespace-nowrap',
                  cell: (o: any) => o.assigned_name ? (
                    <span className="flex min-w-0 items-center gap-2 text-sm md:inline-flex">
                      <Crew people={[{ id: o.assigned_to, name: o.assigned_name, version: o.assigned_avatar }, { id: o.helper_id, name: o.helper_name, version: o.helper_avatar }]} />
                      {/* No celular o nome quebra linha dentro da coluna, sem invadir a agenda ao lado. */}
                      <span className="min-w-0 break-words md:truncate">{o.assigned_name}{o.helper_name && <span className="text-slate-500"> + {o.helper_name.split(' ')[0]}</span>}</span>
                    </span>
                  ) : <span className="text-xs text-amber-700">Sem técnico</span>,
                },
                {
                  key: 'when', header: 'Agenda / conclusão', td: 'whitespace-nowrap',
                  cell: (o: any) => (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                      <CalendarClock className="size-3.5 text-slate-400" />
                      {o.finished_at ? fmtDateTime(o.finished_at) : o.scheduled_for ? fmtDateTime(o.scheduled_for) : 'Sem agenda'}
                    </span>
                  ),
                },
                { key: 'time', header: 'Tempo', td: 'whitespace-nowrap', cell: (o: any) => <WorkTime o={o} /> },
                {
                  key: 'cost', header: 'Compras', mobile: 'hide',
                  cell: (o: any) => (
                    <span className="text-xs whitespace-nowrap text-slate-600">
                      {o.total_cost ? fmtMoney(o.total_cost) : '—'}
                      {o.photos > 0 && <span className="ml-2 inline-flex items-center gap-0.5"><Camera className="size-3.5" />{o.photos}</span>}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </Card>

      <ServiceOrderForm open={creating} onClose={() => setCreating(false)} onSaved={(o) => nav(`/os/${o.id}`)} />
    </div>
  );
}
