import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, Pencil, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DeviceForm from '../components/DeviceForm';
import { ActiveSessions, SecretsList } from '../components/Pppoe';
import { KeyValue, SectionTable, type Section } from '../components/SectionView';
import { IconButton,
  Badge, Button, Card, Checkbox, ConfirmDialog, DeviceStatusBadge, Empty, ErrorBox, Field, Freshness, Input, Notice, PageHeader, Pagination,
  PageSkeleton, PeerStateBadge, Select, Spinner, Tabs, TimeAgo, deviceStatusLabel, usePaged, useToast,
} from '../components/ui';
import { del, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtBps, fmtBytes, fmtDateTime, fmtDuration, isTrue, pct } from '../lib/format';

const TAB_LABEL: Record<string, string> = {
  system: 'Visão geral', interfaces: 'Interfaces', logs: 'Logs', vpn: 'VPN', routes: 'Rotas', firewall: 'Firewall', dhcp: 'DHCP / DNS', queues: 'Filas', ppp: 'PPPoE',
};

export function useModule(deviceId: number, key: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['module', deviceId, key], queryFn: () => get(`/devices/${deviceId}/modules/${key}`) });
  const refresh = useMutation({
    mutationFn: () => get(`/devices/${deviceId}/modules/${key}`, { refresh: 1 }),
    onSuccess: (d) => {
      qc.setQueryData(['module', deviceId, key], d);
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
    },
  });
  return { q, refresh };
}

export function ModuleHeader({ data, onRefresh, loading }: { data: any; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Freshness collectedAt={data?.collectedAt} stale={data?.stale} error={data?.error} />
      <Button onClick={onRefresh} loading={loading}><RefreshCw className="size-4" /> Consultar agora</Button>
    </div>
  );
}

function Bar({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-slate-600">{label}</span><span className="text-slate-500">{detail}</span></div>
      {value == null ? <div className="text-xs text-slate-400">indisponível</div> : (
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className={clsx('h-full rounded-full', value >= 90 ? 'bg-red-500' : value >= 75 ? 'bg-amber-500' : 'bg-blue-500')} style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
    </div>
  );
}

function SystemTab({ deviceId }: { deviceId: number }) {
  const { q, refresh } = useModule(deviceId, 'system');
  if (q.isLoading) return <Spinner label="Consultando o equipamento…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const sec = (k: string): Section => d.sections.find((s: any) => s.key === k);
  const res = sec('resource');
  const r = res?.ok ? res.rows![0] ?? {} : null;
  const rb = sec('routerboard');
  const idt = sec('identity');
  const lic = sec('license');
  return (
    <div className="space-y-4">
      <ModuleHeader data={d} onRefresh={() => refresh.mutate()} loading={refresh.isPending} />
      {refresh.error && <ErrorBox error={refresh.error} />}
      {!r ? (
        <Notice>Recursos do sistema indisponíveis: {res?.reason ?? 'sem coleta'}</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Identificação">
            <dl className="space-y-1.5 text-sm">
              {[
                ['Identidade', idt?.ok ? idt.rows?.[0]?.name : '—'],
                ['Modelo', (rb?.ok && rb.rows?.[0]?.model) || r['board-name']],
                ['Arquitetura', r['architecture-name']],
                ['RouterOS', r.version],
                ['Firmware', rb?.ok ? rb.rows?.[0]?.['current-firmware'] : 'n/d (não é RouterBOARD)'],
                ['Serial', rb?.ok ? rb.rows?.[0]?.['serial-number'] : '—'],
                ['Licença', lic?.ok ? (lic.rows?.[0]?.nlevel ?? lic.rows?.[0]?.level ?? '—') : '—'],
                ['Uptime', r.uptime],
                ['Build', r['build-time']],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v || '—'}</dd></div>
              ))}
            </dl>
          </Card>
          <Card title="Recursos" className="lg:col-span-2">
            <div className="space-y-4">
              <Bar label="CPU" value={r['cpu-load'] != null ? Number(r['cpu-load']) : null} detail={`${r['cpu-load'] ?? '?'}% · ${r['cpu-count'] ?? '?'} núcleo(s) · ${r['cpu-frequency'] ?? '?'} MHz · ${r.cpu ?? ''}`} />
              <Bar label="Memória" value={pct(r['free-memory'], r['total-memory'])} detail={`${fmtBytes(Number(r['total-memory']) - Number(r['free-memory']))} de ${fmtBytes(r['total-memory'])}`} />
              <Bar label="Armazenamento" value={pct(r['free-hdd-space'], r['total-hdd-space'])} detail={`${fmtBytes(Number(r['total-hdd-space']) - Number(r['free-hdd-space']))} de ${fmtBytes(r['total-hdd-space'])}`} />
              {r['bad-blocks'] && <div className="text-xs text-slate-500">Bad blocks: {r['bad-blocks']}</div>}
            </div>
          </Card>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionTable module="system" section={sec('health')} />
        <SectionTable module="system" section={sec('packages')} />
      </div>
      <SectionTable module="system" section={sec('disks')} />
      {sec('clock')?.ok && <Card title="Relógio"><KeyValue row={sec('clock').rows![0] ?? {}} /></Card>}
    </div>
  );
}

function TrafficMonitor({ deviceId, interfaces }: { deviceId: number; interfaces: string[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => setSelected((s) => (s.length ? s : interfaces.slice(0, 4))), [interfaces]);
  const q = useQuery({
    queryKey: ['traffic', deviceId, selected.join(',')],
    queryFn: () => get(`/devices/${deviceId}/traffic`, { interfaces: selected.join(',') }),
    enabled: running && selected.length > 0,
    refetchInterval: running ? 3000 : false,
    meta: { live: false },
  });
  return (
    <Card
      title={<span className="flex items-center gap-2"><Activity className="size-4" /> Tráfego em tempo real</span>}
      actions={<Button variant={running ? 'danger' : 'primary'} onClick={() => setRunning((v) => !v)} disabled={!selected.length}>{running ? 'Parar' : 'Iniciar (a cada 3 s)'}</Button>}
    >
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {interfaces.map((n) => (
          <Checkbox key={n} label={n} checked={selected.includes(n)} onChange={(v) => setSelected((s) => (v ? [...s, n].slice(0, 12) : s.filter((x) => x !== n)))} />
        ))}
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {running && q.data && (
        <table className="tbl">
          <thead><tr><th>Interface</th><th>Download (rx)</th><th>Upload (tx)</th><th>Pacotes rx/tx</th></tr></thead>
          <tbody>
            {q.data.rows.map((r: any) => (
              <tr key={r.name}><td className="font-medium">{r.name}</td><td className="tabular-nums">{fmtBps(r.rxBps)}</td><td className="tabular-nums">{fmtBps(r.txBps)}</td><td className="text-xs">{r.rxPps} / {r.txPps}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {running && q.data && <div className="mt-2 text-xs text-slate-500">Leitura de {fmtDateTime(q.data.collectedAt)}</div>}
    </Card>
  );
}

function GenericTab({ deviceId, moduleKey }: { deviceId: number; moduleKey: string }) {
  const { q, refresh } = useModule(deviceId, moduleKey);
  if (q.isLoading) return <Spinner label="Consultando o equipamento…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const sections: Section[] = q.data.sections;
  const ifaces = moduleKey === 'interfaces' ? (sections.find((s) => s.key === 'interfaces')?.rows ?? []).filter((r) => !isTrue(r.disabled)).map((r) => r.name) : [];
  return (
    <div className="space-y-4">
      <ModuleHeader data={q.data} onRefresh={() => refresh.mutate()} loading={refresh.isPending} />
      {refresh.error && <ErrorBox error={refresh.error} />}
      {moduleKey === 'interfaces' && ifaces.length > 0 && <TrafficMonitor deviceId={deviceId} interfaces={ifaces} />}
      {sections.map((s) => <SectionTable key={s.key} module={moduleKey} section={s} />)}
    </div>
  );
}

function LogsTab({ deviceId }: { deviceId: number }) {
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [nonce, setNonce] = useState(0);
  const q = useQuery({
    queryKey: ['logs', deviceId, topic, text, from, to, nonce],
    queryFn: () => get(`/devices/${deviceId}/logs`, { topic, q: text, from, to, refresh: nonce ? 1 : undefined }),
    placeholderData: (p) => p,
  });
  const rows = q.data?.rows ?? [];
  const paged = usePaged(rows, 100);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {q.data && <Freshness collectedAt={q.data.collectedAt} stale={q.data.stale} error={q.data.error} />}
        <Button onClick={() => setNonce((n) => n + 1)} loading={q.isPlaceholderData}><RefreshCw className="size-4" /> Consultar agora</Button>
      </div>
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Tópico">
            <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">Todos</option>
              {(q.data?.topics ?? []).map((t: string) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Conteúdo"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto da mensagem" /></Field>
          <Field label="De (hora do roteador)"><Input type="datetime-local" step="1" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Input type="datetime-local" step="1" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          O período disponível depende do buffer de log do equipamento (por padrão ~1000 linhas em memória).
          {q.data?.routerDate && <> Data no roteador: {q.data.routerDate}{q.data.gmtOffset ? ` (GMT ${q.data.gmtOffset})` : ''}.</>}
        </p>
      </Card>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data && !q.data.available ? <Notice>Logs indisponíveis: {q.data.reason}</Notice> : (
        <Card bodyClass="" title={`${rows.length} linhas`}>
          {rows.length === 0 ? <Empty>Nenhuma linha com esses filtros.</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Horário</th><th>Tópicos</th><th>Mensagem</th></tr></thead>
                <tbody>
                  {paged.slice.map((r: any, i: number) => (
                    <tr key={r.id ?? i} className={clsx(r.topics.some((t: string) => ['error', 'critical'].includes(t)) && 'bg-red-50/60', r.topics.includes('warning') && 'bg-amber-50/60')}>
                      <td className="mono whitespace-nowrap">{r.ts ?? r.time}</td>
                      <td className="whitespace-nowrap text-xs">{r.topics.join(', ')}</td>
                      <td className="mono break-all">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function PppTab({ deviceId, initialSearch }: { deviceId: number; initialSearch?: string }) {
  const [sub, setSub] = useState('secrets');
  return (
    <div className="space-y-4">
      <Tabs tabs={[{ key: 'secrets', label: 'Usuários (secrets)' }, { key: 'active', label: 'Sessões ativas' }, { key: 'profiles', label: 'Perfis e servidores' }]} active={sub} onChange={setSub} />
      {sub === 'secrets' && <SecretsList deviceId={deviceId} initialSearch={initialSearch} />}
      {sub === 'active' && <ActiveSessions deviceId={deviceId} />}
      {sub === 'profiles' && <PppProfiles deviceId={deviceId} />}
    </div>
  );
}

function PppProfiles({ deviceId }: { deviceId: number }) {
  const { q, refresh } = useModule(deviceId, 'ppp');
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div className="space-y-4">
      <ModuleHeader data={q.data} onRefresh={() => refresh.mutate()} loading={refresh.isPending} />
      {q.data.sections.filter((s: Section) => s.key === 'profiles' || s.key === 'servers').map((s: Section) => <SectionTable key={s.key} module="ppp" section={s} />)}
    </div>
  );
}

export default function DeviceDetailPage() {
  const { id } = useParams();
  const deviceId = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const dev = useQuery({ queryKey: ['device', deviceId], queryFn: () => get(`/devices/${deviceId}`) });
  const [editing, setEditing] = useState<any>(null);
  const [removing, setRemoving] = useState(false);

  const check = useMutation({
    mutationFn: () => post(`/devices/${deviceId}/check`),
    onSuccess: (r) => {
      (r.status === 'online' ? toast.ok : toast.err)(`Status: ${deviceStatusLabel(r.status)}${r.status_message ? ` — ${r.status_message}` : ''}`);
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
      qc.invalidateQueries({ queryKey: ['module', deviceId] });
    },
    onError: toast.err,
  });
  const tabs = useMemo(() => (dev.data?.modules ?? []).map((m: any) => ({ key: m.key, label: TAB_LABEL[m.key] ?? m.label })), [dev.data]);
  const tab = params.get('aba') ?? tabs[0]?.key ?? 'system';

  if (dev.isLoading) return <PageSkeleton />;
  if (dev.error) return <ErrorBox error={dev.error} />;
  const d = dev.data;

  const doDelete = async () => {
    try {
      await del(`/devices/${deviceId}`, { confirm: d.name });
      toast.ok('Equipamento excluído.');
      qc.invalidateQueries({ queryKey: ['devices'] });
      nav('/equipamentos');
    } catch (e) {
      toast.err(e);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{d.name} {d.is_central && <Badge color="purple">central</Badge>}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {d.client_name && <span>{d.client_name}</span>}
            <span className="mono">{d.host}</span>
            <span>{d.ros_version ? `RouterOS ${d.ros_version}` : 'versão não coletada'}</span>
            {d.board_name && <span>{d.board_name}</span>}
            <span>acesso: {d.detected_method ?? d.api_method}</span>
          </span>
        }
        actions={
          <>
            <Button onClick={() => check.mutate()} loading={check.isPending}><RefreshCw className="size-4" /> Verificar agora</Button>
            {can('audit.view') && (
              <Link to={`/auditoria/${d.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50">
                <ScrollText className="size-4" /> Auditoria
              </Link>
            )}
            {can('devices.manage') && <Button onClick={() => setEditing({ ...d })}><Pencil className="size-4" /> Editar</Button>}
            {can('devices.manage') && <IconButton icon={Trash2} label="Excluir" tone="danger" onClick={() => setRemoving(true)} />}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="text-xs text-slate-500">Gerência (API/REST)</div>
          <div className="mt-1"><DeviceStatusBadge status={d.status} /></div>
          {d.status_message && <div className="mt-1 break-words text-xs text-slate-500">{d.status_message}</div>}
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="text-xs text-slate-500">Túnel WireGuard (visto pela central)</div>
          <div className="mt-1"><PeerStateBadge state={d.peer_state} /></div>
          {d.peer_id && <div className="mt-1 text-xs text-slate-500">{d.peer_last_handshake_seconds == null ? 'sem handshake' : `handshake há ${fmtDuration(d.peer_last_handshake_seconds + (Date.now() - new Date(d.peer_collected_at).getTime()) / 1000)}`}{!d.peer_present && ' · peer removido da central'}</div>}
          {!d.peer_id && can('wireguard.link') && <Link to="/wireguard" className="text-xs text-brand-700 hover:underline">vincular peer</Link>}
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="text-xs text-slate-500">Última resposta</div>
          <div className="mt-1 text-sm font-medium"><TimeAgo date={d.last_ok_at} /></div>
          <div className="text-xs text-slate-500">{fmtDateTime(d.last_ok_at)}</div>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="text-xs text-slate-500">Última tentativa</div>
          <div className="mt-1 text-sm font-medium"><TimeAgo date={d.last_poll_at} /></div>
          <div className="text-xs text-slate-500">{d.poll_enabled ? 'coleta periódica ativa' : 'coleta periódica desativada'}</div>
        </div>
      </div>

      {d.status !== 'online' && d.status !== 'unknown' && (
        <Notice>Equipamento {deviceStatusLabel(d.status).toLowerCase()}. As abas mostram a última coleta disponível, marcada como desatualizada.</Notice>
      )}

      <Tabs tabs={tabs} active={tab} onChange={(k) => setParams({ aba: k }, { replace: true })} />
      <div key={tab}>
        {tab === 'system' && <SystemTab deviceId={deviceId} />}
        {tab === 'logs' && <LogsTab deviceId={deviceId} />}
        {tab === 'ppp' && <PppTab deviceId={deviceId} initialSearch={params.get('busca') ?? ''} />}
        {!['system', 'logs', 'ppp'].includes(tab) && <GenericTab deviceId={deviceId} moduleKey={tab} />}
      </div>

      {d.events?.length > 0 && (
        <Card title="Histórico de status de gerência" bodyClass="">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Status</th><th>Detalhe</th></tr></thead>
            <tbody>
              {d.events.map((e: any, i: number) => (
                <tr key={i}><td className="whitespace-nowrap text-xs">{fmtDateTime(e.at)}</td><td><DeviceStatusBadge status={e.status} /></td><td className="break-words text-xs">{e.message}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <DeviceForm open={!!editing} initial={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={doDelete}
        title="Excluir equipamento"
        confirmLabel="Excluir do sistema"
        message={<>Remove <b>{d.name}</b> do sistema (cadastro, cache e vínculos). Nada é alterado no roteador. O histórico de auditoria é mantido.</>}
        confirmText={d.name}
      />
    </div>
  );
}
