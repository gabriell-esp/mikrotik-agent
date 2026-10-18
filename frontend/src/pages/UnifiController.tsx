import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronRight, Download, LocateFixed, LocateOff, Pencil, Power, PowerOff, RefreshCw, RotateCw, ScrollText, Trash2, Unlock, UserX, Wifi } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DataList, { type Col } from '../components/DataList';
import RowActions from '../components/RowActions';
import UnifiForm from '../components/UnifiForm';
import {
  Badge, Button, Card, ConfirmDialog, DeviceStatusBadge, Empty, ErrorBox, Freshness, Notice, PageHeader, PageSkeleton, Pagination,
  SearchBox, TableSkeleton, Tabs, usePaged, useToast,
} from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtBytes, fmtDuration } from '../lib/format';

const STATE: Record<string, { label: string; color: 'green' | 'red' | 'amber' | 'blue' | 'slate' }> = {
  online: { label: 'Conectado', color: 'green' },
  offline: { label: 'Desconectado', color: 'red' },
  pending: { label: 'Aguardando adoção', color: 'amber' },
  upgrading: { label: 'Atualizando', color: 'blue' },
  provisioning: { label: 'Provisionando', color: 'blue' },
  heartbeat_missed: { label: 'Sem resposta', color: 'amber' },
  adopting: { label: 'Adotando', color: 'blue' },
  adoption_error: { label: 'Erro de adoção', color: 'red' },
  adoption_failed: { label: 'Adoção falhou', color: 'red' },
  isolated: { label: 'Isolado', color: 'amber' },
};
const stateOf = (s: string) => STATE[s] ?? { label: s, color: 'slate' as const };

function securityLabel(sec: string | null, mode: string | null): string {
  if (!sec || sec === 'open') return 'Aberta (sem senha)';
  const ver = mode === 'wpa3' ? 'WPA3' : mode === 'wpa2' ? 'WPA2' : mode === 'wpa1' || mode === 'wpa' ? 'WPA' : 'WPA';
  return sec === 'wpapsk' ? `${ver} Pessoal` : sec === 'wpaeap' ? `${ver} Empresarial` : sec.toUpperCase();
}

const TYPE: Record<string, string> = { uap: 'Antena', usw: 'Switch', ugw: 'Gateway', udm: 'Dream Machine', uxg: 'Gateway' };
const mbps = (kbps: number | null) => (kbps == null ? '—' : `${Math.round(kbps / 1000)} Mbps`);

function signalTone(dbm: number | null): 'green' | 'amber' | 'red' | 'slate' {
  if (dbm == null) return 'slate';
  return dbm >= -60 ? 'green' : dbm >= -70 ? 'amber' : 'red';
}

interface Confirm {
  title: string;
  message: React.ReactNode;
  label: string;
  danger?: boolean;
  run: () => Promise<unknown>;
}

/** O que a controladora permite (o acesso por API key tem menos ações que usuário/senha). */
export type Caps = Record<'restart' | 'locate' | 'upgrade' | 'kick' | 'block' | 'blockedList' | 'wlans' | 'wlanToggle' | 'signal', boolean>;
const ALL_CAPS: Caps = { restart: true, locate: true, upgrade: true, kick: true, block: true, blockedList: true, wlans: true, wlanToggle: true, signal: true };

function useSiteData(id: number, site: string, kind: string, on = true) {
  return useQuery({
    queryKey: ['unifi', id, site, kind],
    queryFn: () => get(`/unifi/controllers/${id}/sites/${site}/${kind}`),
    enabled: !!site && on,
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------- dispositivos

function Devices({ id, site, ask, caps }: { id: number; site: string; ask: (c: Confirm) => void; caps: Caps }) {
  const { can } = useAuth();
  const q = useSiteData(id, site, 'devices');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const t = search.toLowerCase();
    return (q.data?.rows ?? []).filter((d: any) => !t || [d.name, d.ip, d.mac, d.model_name].join(' ').toLowerCase().includes(t));
  }, [q.data, search]);
  const paged = usePaged(rows, 25);
  const act = (d: any, action: string) => post(`/unifi/controllers/${id}/sites/${site}/devices/${d.mac}/action`, { action, name: d.name, confirm: true });

  return (
    <Card bodyClass="" title={`${rows.length} dispositivo(s)`} actions={(q.data?.rows?.length ?? 0) > 6 && <SearchBox value={search} onChange={setSearch} placeholder="Nome, IP, MAC, modelo…" className="w-full sm:w-64" />}>
      {q.isLoading ? <TableSkeleton cols={6} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !rows.length ? <Empty icon={Wifi}>Nenhum dispositivo neste site.</Empty> : (
        <>
          <DataList
            rows={paged.slice}
            rowKey={(d: any) => d.mac}
            accent={(d: any) => stateOf(d.state).color === 'blue' ? 'blue' : stateOf(d.state).color as any}
            cols={[
              {
                key: 'name', header: 'Dispositivo', mobile: 'title',
                cell: (d: any) => <div><span className="font-medium text-slate-900">{d.name}</span><span className="block text-xs font-normal text-slate-500">{TYPE[d.type] ?? d.type} · {d.model_name}</span></div>,
              },
              { key: 'ip', header: 'IP / MAC', mobile: 'subtitle', cell: (d: any) => <span className="mono">{d.ip ?? '—'}<span className="max-md:before:content-['_·_'] md:block">{d.mac}</span></span> },
              {
                key: 'state', header: 'Status', mobile: 'badges',
                cell: (d: any) => (
                  <div className="flex flex-wrap gap-1">
                    <Badge color={stateOf(d.state).color} dot>{stateOf(d.state).label}</Badge>
                    {d.locating && <Badge color="purple">Localizando</Badge>}
                    {d.upgradable && <Badge color="blue" title={d.upgrade_to ? `Versão ${d.upgrade_to}` : undefined}>Atualização disponível</Badge>}
                  </div>
                ),
              },
              { key: 'clients', header: 'Clientes', cell: (d: any) => <span className="tabular-nums">{d.clients}</span> },
              {
                key: 'radios', header: 'Rádios', label: 'Rádios', mobile: 'full',
                cell: (d: any) => d.radios.length ? (
                  <div className="space-y-0.5 text-xs">
                    {d.radios.map((r: any) => (
                      <div key={r.name}>{r.band}: canal {r.channel ?? '—'}{r.tx_power != null ? ` · ${r.tx_power} dBm` : ''}{r.clients != null ? ` · ${r.clients} cliente(s)` : ''}{r.utilization != null ? ` · uso ${r.utilization}%` : ''}</div>
                    ))}
                  </div>
                ) : <span className="text-slate-300">—</span>,
              },
              { key: 'version', header: 'Firmware', cell: (d: any) => <span className="text-xs">{d.version ?? '—'}</span> },
              {
                key: 'uptime', header: 'Ligado há',
                cell: (d: any) => (
                  <span className="text-xs">
                    {d.state === 'online' && d.uptime != null ? fmtDuration(d.uptime) : '—'}
                    {d.cpu != null && <span className="block text-slate-500">CPU {Math.round(d.cpu)}%{d.memory != null ? ` · mem. ${Math.round(d.memory)}%` : ''}</span>}
                  </span>
                ),
              },
              {
                key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                cell: (d: any) => (
                  <RowActions
                    title={d.name}
                    actions={[
                      {
                        icon: d.locating ? LocateOff : LocateFixed, label: d.locating ? 'Parar de localizar' : 'Localizar (piscar LED)', show: caps.locate && can('unifi.control') && d.state === 'online',
                        onClick: () => ask({ title: d.locating ? 'Parar de localizar' : 'Localizar dispositivo', label: 'Confirmar', danger: false, message: <>O LED de <b>{d.name}</b> {d.locating ? 'volta ao normal' : 'vai piscar para facilitar encontrar o equipamento'}.</>, run: () => act(d, d.locating ? 'unlocate' : 'locate') }),
                      },
                      {
                        icon: RotateCw, label: 'Reiniciar', tone: 'warning', show: caps.restart && can('unifi.control') && d.state !== 'offline',
                        onClick: () => ask({ title: 'Reiniciar dispositivo', label: 'Reiniciar', message: <>Reiniciar <b>{d.name}</b>? Os {d.clients} cliente(s) conectados ficam sem Wi-Fi por cerca de 1 a 3 minutos.</>, run: () => act(d, 'restart') }),
                      },
                      {
                        icon: Download, label: `Atualizar firmware${d.upgrade_to ? ` (${d.upgrade_to})` : ''}`, short: 'Atualizar firmware', show: caps.upgrade && can('unifi.control') && d.upgradable,
                        onClick: () => ask({ title: 'Atualizar firmware', label: 'Atualizar', message: <>Atualizar <b>{d.name}</b> de {d.version} para {d.upgrade_to ?? 'a versão mais recente'}? O dispositivo reinicia durante a atualização (alguns minutos sem Wi-Fi).</>, run: () => act(d, 'upgrade') }),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- clientes

function Clients({ id, site, ask, caps }: { id: number; site: string; ask: (c: Confirm) => void; caps: Caps }) {
  const { can } = useAuth();
  const q = useSiteData(id, site, 'clients');
  const blocked = useSiteData(id, site, 'blocked', caps.blockedList);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const t = search.toLowerCase();
    return (q.data?.rows ?? [])
      .filter((c: any) => !t || [c.name, c.ip, c.mac, c.ap_name, c.essid, c.vendor].join(' ').toLowerCase().includes(t))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true }));
  }, [q.data, search]);
  const paged = usePaged(rows, 30);
  const act = (c: any, action: string) => post(`/unifi/controllers/${id}/sites/${site}/clients/${c.mac}/action`, { action, name: c.name, confirm: true });

  return (
    <div className="space-y-4">
      <Card bodyClass="" title={`${rows.length} cliente(s) conectado(s)`} actions={<SearchBox value={search} onChange={setSearch} placeholder="Nome, IP, MAC, antena, rede…" className="w-full sm:w-64" />}>
        {q.isLoading ? <TableSkeleton cols={6} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !rows.length ? <Empty>Nenhum cliente conectado.</Empty> : (
          <>
            <DataList
              rows={paged.slice}
              rowKey={(c: any) => c.mac}
              accent={(c: any) => (c.wired ? 'slate' : caps.signal ? signalTone(c.signal) : 'blue')}
              cols={([
                { key: 'name', header: 'Cliente', mobile: 'title', cell: (c: any) => <div><span className="font-medium text-slate-900">{c.name}</span>{c.vendor && c.vendor !== c.name && <span className="block text-xs font-normal text-slate-500">{c.vendor}</span>}</div> },
                { key: 'ip', header: 'IP / MAC', mobile: 'subtitle', cell: (c: any) => <span className="mono">{c.ip ?? '—'}<span className="max-md:before:content-['_·_'] md:block">{c.mac}</span></span> },
                {
                  key: 'signal', header: caps.signal ? 'Sinal' : 'Conexão', mobile: 'badges',
                  cell: (c: any) => c.wired ? <Badge>Cabo</Badge> : (
                    <div className="flex flex-wrap gap-1">
                      {caps.signal ? <Badge color={signalTone(c.signal)} dot>{c.signal != null ? `${c.signal} dBm` : 'sinal —'}</Badge> : <Badge color="blue">Wi-Fi</Badge>}
                      {c.band && <Badge>{c.band}</Badge>}
                      {c.guest && <Badge color="purple">Visitante</Badge>}
                    </div>
                  ),
                },
                { key: 'ap', header: 'Antena', cell: (c: any) => <span className="text-xs">{c.ap_name ?? '—'}</span> },
                { key: 'ssid', header: 'Rede', cell: (c: any) => <span className="text-xs">{c.essid ?? '—'}</span> },
                // tx_rate = antena → aparelho (download do cliente); rx_rate = aparelho → antena (upload)
                { key: 'rate', header: 'Velocidade', cell: (c: any) => <span className="text-xs whitespace-nowrap">↓ {mbps(c.tx_rate)} · ↑ {mbps(c.rx_rate)}</span> },
                { key: 'uptime', header: 'Conectado há', cell: (c: any) => <span className="text-xs">{c.uptime != null ? fmtDuration(c.uptime) : '—'}</span> },
                { key: 'traffic', header: 'Tráfego', mobile: 'hide', cell: (c: any) => <span className="text-xs whitespace-nowrap">↓ {fmtBytes(c.tx_bytes)} · ↑ {fmtBytes(c.rx_bytes)}</span> },
                {
                  key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right', hidden: !caps.kick && !caps.block,
                  cell: (c: any) => (
                    <RowActions
                      title={c.name}
                      actions={[
                        {
                          icon: RefreshCw, label: 'Reconectar', show: caps.kick && can('unifi.control') && !c.wired,
                          onClick: () => ask({ title: 'Reconectar cliente', label: 'Reconectar', danger: false, message: <>Desconectar <b>{c.name}</b> do Wi-Fi? O aparelho normalmente se reconecta sozinho em segundos.</>, run: () => act(c, 'kick') }),
                        },
                        {
                          icon: Ban, label: 'Bloquear', tone: 'danger', show: caps.block && can('unifi.control'),
                          onClick: () => ask({ title: 'Bloquear cliente', label: 'Bloquear', message: <>Bloquear <b>{c.name}</b> ({c.mac})? O aparelho não conseguirá mais se conectar em nenhuma rede desta controladora até ser desbloqueado.</>, run: () => act(c, 'block') }),
                        },
                      ]}
                    />
                  ),
                },
              ] as (Col<any> & { hidden?: boolean })[]).filter((col) => !col.hidden && (caps.signal || !['ssid', 'rate', 'traffic'].includes(col.key)))}
            />
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </Card>

      {caps.blockedList && (blocked.data?.rows?.length ?? 0) > 0 && (
        <Card title={`Bloqueados (${blocked.data.rows.length})`} icon={UserX} bodyClass="">
          <DataList
            rows={blocked.data.rows}
            rowKey={(c: any) => c.mac}
            accent={() => 'red'}
            cols={[
              { key: 'name', header: 'Cliente', mobile: 'title', cell: (c: any) => <span className="font-medium">{c.name}</span> },
              { key: 'mac', header: 'MAC', mobile: 'subtitle', cell: (c: any) => <span className="mono">{c.mac}</span> },
              {
                key: 'actions', header: '', mobile: 'actions', td: 'text-right',
                cell: (c: any) => (
                  <RowActions title={c.name} actions={[{ icon: Unlock, label: 'Desbloquear', tone: 'success', show: can('unifi.control'), onClick: () => ask({ title: 'Desbloquear cliente', label: 'Desbloquear', danger: false, message: <>Permitir que <b>{c.name}</b> volte a se conectar?</>, run: () => act(c, 'unblock') }) }]} />
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------- redes Wi-Fi

function Wlans({ id, site, ask, caps }: { id: number; site: string; ask: (c: Confirm) => void; caps: Caps }) {
  const { can } = useAuth();
  const q = useSiteData(id, site, 'wlans');
  const rows = q.data?.rows ?? [];
  const toggle = (w: any) => put(`/unifi/controllers/${id}/sites/${site}/wlans/${w.id}`, { enabled: !w.enabled, name: w.name });
  return (
    <Card bodyClass="" title={`${rows.length} rede(s) Wi-Fi`}>
      {q.isLoading ? <TableSkeleton cols={5} rows={3} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !rows.length ? <Empty icon={Wifi}>Nenhuma rede Wi-Fi.</Empty> : (
        <DataList
          rows={rows}
          rowKey={(w: any) => w.id}
          accent={(w: any) => (w.enabled ? 'green' : 'slate')}
          cols={[
            { key: 'name', header: 'Rede (SSID)', mobile: 'title', cell: (w: any) => <span className="font-medium text-slate-900">{w.name}</span> },
            {
              key: 'state', header: 'Situação', mobile: 'badges',
              cell: (w: any) => (
                <div className="flex flex-wrap gap-1">
                  {w.enabled ? <Badge color="green" dot>Ativa</Badge> : <Badge dot>Desativada</Badge>}
                  {w.guest && <Badge color="purple">Visitantes</Badge>}
                  {w.hidden && <Badge>Oculta</Badge>}
                </div>
              ),
            },
            { key: 'security', header: 'Segurança', cell: (w: any) => <span className="text-xs">{securityLabel(w.security, w.wpa_mode)}</span> },
            { key: 'band', header: 'Bandas', cell: (w: any) => <span className="text-xs">{w.band ?? '—'}</span> },
            { key: 'clients', header: 'Clientes', cell: (w: any) => <span className="tabular-nums">{w.clients ?? '—'}</span> },
            {
              key: 'actions', header: '', mobile: 'actions', td: 'text-right',
              cell: (w: any) => (
                <RowActions
                  title={w.name}
                  actions={[{
                    icon: w.enabled ? PowerOff : Power, label: w.enabled ? 'Desativar rede' : 'Ativar rede', tone: w.enabled ? 'danger' : 'success', show: caps.wlanToggle && can('unifi.control'),
                    onClick: () => ask({
                      title: w.enabled ? 'Desativar rede Wi-Fi' : 'Ativar rede Wi-Fi', label: w.enabled ? 'Desativar' : 'Ativar', danger: w.enabled,
                      message: w.enabled ? <>Desativar <b>{w.name}</b>? {w.clients != null ? `Os ${w.clients} aparelho(s) conectados` : 'Os aparelhos conectados'} nela perdem o Wi-Fi.</> : <>Ativar novamente a rede <b>{w.name}</b>?</>,
                      run: () => toggle(w),
                    }),
                  }]}
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

// ------------------------------------------------------------- página

export default function UnifiControllerPage() {
  const { id } = useParams();
  const cid = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const ctrl = useQuery({ queryKey: ['unifi', cid, 'info'], queryFn: () => get(`/unifi/controllers/${cid}`) });
  const [editing, setEditing] = useState<any>(null);
  const [removing, setRemoving] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useMutation({
    mutationFn: () => post(`/unifi/controllers/${cid}/refresh`),
    onSuccess: (r) => {
      if (r.ok) toast.ok('Controladora lida agora.');
      else toast.err(r.error);
      qc.invalidateQueries({ queryKey: ['unifi'] });
    },
    onError: toast.err,
  });

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      toast.ok(`${confirm.title}: comando enviado.`);
      setConfirm(null);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['unifi', cid] }), 1500);
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };

  if (ctrl.isLoading) return <PageSkeleton />;
  if (ctrl.error) return <ErrorBox error={ctrl.error} />;
  const c = ctrl.data;
  const sites: any[] = c.sites ?? [];
  const site = params.get('site') ?? sites[0]?.name ?? '';
  const caps: Caps = c.capabilities ?? ALL_CAPS;
  const tab = !caps.wlans && params.get('aba') === 'redes' ? 'dispositivos' : params.get('aba') ?? 'dispositivos';
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  const doDelete = async () => {
    try {
      await del(`/unifi/controllers/${cid}`, { confirm: c.name });
      toast.ok('Controladora removida do sistema.');
      qc.invalidateQueries({ queryKey: ['unifi'] });
      nav('/unifi');
    } catch (e) {
      toast.err(e);
    }
  };

  const s = c.summary;
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={<span className="flex items-center gap-1"><Link to="/unifi" className="hover:text-brand-700">UniFi</Link><ChevronRight className="size-3" />{c.client_name ?? c.name}</span>}
        title={c.client_name ?? c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{c.name}</span>
            <span className="mono">{c.url.replace(/^https?:\/\//, '')}</span>
            {c.version && <span>Network {c.version}</span>}
            {c.auth_type === 'apikey' && <Badge color="blue">API key</Badge>}
            {c.platform && <span className="max-sm:hidden">{c.platform === 'unifios' ? 'UniFi OS' : 'controlador clássico'}</span>}
            <DeviceStatusBadge status={c.status} title={c.status_message} />
          </span>
        }
        actions={
          <>
            <Button className="flex-1 sm:flex-none" onClick={() => refresh.mutate()} loading={refresh.isPending}><RefreshCw className="size-4" /> Ler agora</Button>
            <RowActions
              title={c.name}
              actions={[
                { icon: ScrollText, label: 'Auditoria', onClick: () => nav(`/auditoria/unifi-${cid}`), show: can('audit.view') },
                { icon: Pencil, label: 'Editar', onClick: () => setEditing({ ...c }), show: can('unifi.manage') },
                { icon: Trash2, label: 'Excluir', tone: 'danger', onClick: () => setRemoving(true), show: can('unifi.manage') },
              ]}
            />
          </>
        }
      />

      <Freshness collectedAt={c.sync?.collectedAt} stale={c.sync?.stale} error={c.sync?.error} />
      {c.status !== 'online' && c.status !== 'unknown' && (
        <Notice>Controladora inacessível no momento: os dados abaixo são da última leitura. {c.status_message}</Notice>
      )}

      <div className="grid grid-cols-4 divide-x divide-slate-100 rounded-2xl border border-slate-200/80 bg-white py-3 shadow-xs">
        {[
          { l: 'Online', v: s.online, cl: 'text-emerald-600' },
          { l: 'Offline', v: s.offline, cl: s.offline ? 'text-red-600' : 'text-slate-900' },
          { l: 'Clientes', v: s.clients, cl: 'text-slate-900' },
          { l: 'Atualizar', v: s.upgradable, cl: s.upgradable ? 'text-brand-600' : 'text-slate-900' },
        ].map((m) => (
          <div key={m.l} className="text-center">
            <div className={`text-xl font-semibold tabular-nums sm:text-2xl ${m.cl}`}>{m.v}</div>
            <div className="text-[11px] text-slate-500 sm:text-xs">{m.l}</div>
          </div>
        ))}
      </div>

      {sites.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          {sites.map((x) => (
            <button
              key={x.name}
              onClick={() => setParam('site', x.name)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${x.name === site ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {x.desc}
            </button>
          ))}
        </div>
      )}

      {!site ? (
        <Notice kind="info">Nenhum site lido ainda. Clique em “Ler agora”.</Notice>
      ) : (
        <>
          <Tabs
            tabs={[{ key: 'dispositivos', label: 'Antenas e dispositivos' }, { key: 'clientes', label: 'Clientes Wi-Fi' }, ...(caps.wlans ? [{ key: 'redes', label: 'Redes Wi-Fi' }] : [])]}
            active={tab}
            onChange={(k) => setParam('aba', k)}
          />
          {c.auth_type === 'apikey' && (
            <Notice kind="info">
              Acesso pela API oficial (API key): reiniciar antenas{caps.wlanToggle ? ' e ativar/desativar redes Wi-Fi' : ''} está disponível. Localizar, atualizar firmware, reconectar e bloquear clientes exigem acesso por usuário e senha.
            </Notice>
          )}
          {tab === 'dispositivos' && <Devices id={cid} site={site} ask={setConfirm} caps={caps} />}
          {tab === 'clientes' && <Clients id={cid} site={site} ask={setConfirm} caps={caps} />}
          {tab === 'redes' && <Wlans id={cid} site={site} ask={setConfirm} caps={caps} />}
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        danger={confirm?.danger !== false}
        title={confirm?.title ?? ''}
        confirmLabel={confirm?.label}
        message={confirm?.message}
      />
      <UnifiForm open={!!editing} initial={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={doDelete}
        title="Excluir controladora"
        confirmLabel="Excluir do sistema"
        message={<>Remove <b>{c.name}</b> do sistema (cadastro e leituras). Nada é alterado na controladora. O histórico de auditoria é mantido.</>}
        confirmText={c.name}
      />
    </div>
  );
}
