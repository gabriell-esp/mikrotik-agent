import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Router, ShieldAlert, Waypoints, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DeviceList from '../components/DeviceList';
import {
  Card, Empty, ErrorBox, PageHeader, PageSkeleton, Pagination, SearchBox, SegmentBar, Select,
  StatCard, TableSkeleton, TimeAgo, usePaged,
} from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

export default function DashboardPage() {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/dashboard') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get('/devices'), enabled: can('devices.view') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: can('clients.view') });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');

  const filtered = useMemo(() => {
    const t = search.toLowerCase();
    return (devices.data ?? []).filter(
      (d: any) =>
        (!status || d.status === status) &&
        (!client || String(d.client_id) === client) &&
        (!t || [d.name, d.host, d.client_name, d.identity, d.peer_name, d.peer_comment].join(' ').toLowerCase().includes(t)),
    );
  }, [devices.data, search, status, client]);
  const paged = usePaged(filtered, 10);

  if (dash.isLoading) return <PageSkeleton />;
  if (dash.error) return <ErrorBox error={dash.error} />;
  const d = dash.data;
  const wg = d.wireguard;
  const c = d.counts;
  const okPct = c.total ? Math.round((c.online / c.total) * 100) : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greet}, ${user?.name.split(' ')[0]}`}
        subtitle={<>Visão geral da rede · última coleta dos equipamentos <TimeAgo date={d.lastDevicePollAt} /></>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Equipamentos" value={c.total} icon={Router} tone="blue" foot={`${c.unknown} ainda não verificado(s)`} />
        <StatCard label="Gerenciáveis" value={c.online} icon={CheckCircle2} tone="green" foot={`${okPct}% do parque responde à API`} hint="Responderam à API/REST na última tentativa" />
        <StatCard label="Inacessíveis" value={c.unreachable} icon={WifiOff} tone={c.unreachable ? 'red' : 'slate'} foot="sem resposta ou serviço recusado" />
        <StatCard label="Autenticação / erro" value={c.auth_failed + c.error} icon={KeyRound} tone={c.auth_failed + c.error ? 'amber' : 'slate'} foot={`${c.auth_failed} credencial · ${c.error} comunicação`} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Disponibilidade de gerência" icon={Activity} subtitle="Resultado real da conexão à API de cada equipamento">
          <SegmentBar
            segments={[
              { label: 'Gerenciáveis', value: c.online, tone: 'green' },
              { label: 'Inacessíveis', value: c.unreachable, tone: 'red' },
              { label: 'Falha de autenticação', value: c.auth_failed, tone: 'amber' },
              { label: 'Erro / não verificado', value: c.error + c.unknown, tone: 'slate' },
            ]}
          />
        </Card>

        {wg ? (
          <Card
            title="Túneis WireGuard"
            icon={Waypoints}
            subtitle={<>Central {wg.central.name} · leitura <TimeAgo date={wg.collectedAt} /></>}
            actions={<Link to="/wireguard" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Ver peers <ArrowRight className="size-3" /></Link>}
          >
            {wg.error && <div className="mb-4 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{wg.error}</div>}
            <SegmentBar
              segments={[
                { label: 'Handshake recente', value: wg.summary.recent, tone: 'green' },
                { label: 'Sem handshake recente', value: wg.summary.stale, tone: 'amber' },
                { label: 'Nunca conectaram', value: wg.summary.never, tone: 'slate' },
                { label: 'Desabilitados', value: wg.summary.disabled, tone: 'red' },
              ]}
            />
            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>{wg.summary.total} peers · <b className="text-brand-700">{wg.summary.unlinked}</b> sem vínculo</span>
              <span title="O estado do túnel não define se a MikroTik está gerenciável — isso é verificado pela conexão à API.">ⓘ túnel ≠ gerência</span>
            </div>
          </Card>
        ) : (
          <Card title="Túneis WireGuard" icon={Waypoints}>
            <Empty icon={Waypoints}>{can('wireguard.view') ? 'MikroTik central ainda não cadastrada.' : 'Sem acesso aos peers da central.'}</Empty>
          </Card>
        )}

        <Card className="md:col-span-2 xl:col-span-1" title="Alertas" icon={ShieldAlert} subtitle={d.alerts.length ? `${d.alerts.length} ativo(s)` : 'Tudo em ordem'} bodyClass="max-h-[296px] overflow-y-auto">
          {d.alerts.length === 0 ? (
            <Empty icon={CheckCircle2}>Nenhum alerta no momento.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.alerts.map((a: any, i: number) => (
                <li key={i}>
                  <button
                    disabled={!a.device_id}
                    onClick={() => a.device_id && nav(`/equipamentos/${a.device_id}`)}
                    className="flex w-full items-start gap-3 px-5 py-3 text-left text-sm hover:bg-slate-50 disabled:hover:bg-transparent"
                  >
                    <span className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', a.level === 'error' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
                      <AlertTriangle className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-slate-700">{a.message}</span>
                      {a.at && <span className="text-xs text-slate-400">{fmtDateTime(a.at)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can('devices.view') && (
        <Card
          title="Equipamentos"
          subtitle={`${filtered.length} de ${devices.data?.length ?? 0}`}
          bodyClass=""
          actions={
            <>
              <SearchBox value={search} onChange={setSearch} placeholder="Cliente, equipamento, IP…" className="w-full sm:w-60" />
              {can('clients.view') && (
                <Select value={client} onChange={(e) => setClient(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-44">
                  <option value="">Cliente: todos</option>
                  {(clients.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
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
          {devices.isLoading ? <TableSkeleton /> : filtered.length === 0 ? <Empty>Nenhum equipamento encontrado.</Empty> : (
            <div>
              <DeviceList rows={paged.slice} />
              <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
