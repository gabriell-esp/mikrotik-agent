import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, RefreshCw, Unlink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataList from '../components/DataList';
import DeviceForm, { type DeviceFormInitial } from '../components/DeviceForm';
import {
  Badge, Button, Card, Checkbox, IconButton, DeviceStatusBadge, Empty, ErrorBox, Field, Freshness, Modal, Notice, PageHeader, Pagination,
  PageSkeleton, PeerStateBadge, SearchBox, Select, usePaged, useToast,
} from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtBytes, fmtDuration } from '../lib/format';

function handshakeAge(p: any): number | null {
  if (p.last_handshake_seconds == null) return null;
  return p.last_handshake_seconds + (Date.now() - new Date(p.collected_at).getTime()) / 1000;
}

const endpoint = (a?: string | null, port?: number | null) => (a ? `${a}${port ? `:${port}` : ''}` : '—');

export default function WireguardPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const peers = useQuery({ queryKey: ['wg-peers'], queryFn: () => get('/wireguard/peers') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get('/devices') });
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [link, setLink] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [linking, setLinking] = useState<any>(null);
  const [linkDevice, setLinkDevice] = useState('');
  const [creating, setCreating] = useState<DeviceFormInitial | undefined>();

  const sync = useMutation({
    mutationFn: () => post('/wireguard/sync'),
    onSuccess: (r) => {
      if (r.ok) toast.ok(`${r.count} peers lidos da central.`);
      else toast.err(r.error);
      qc.invalidateQueries({ queryKey: ['wg-peers'] });
    },
    onError: toast.err,
  });

  const saveLink = useMutation({
    mutationFn: ({ id, device_id }: { id: number; device_id: number | null }) => put(`/wireguard/peers/${id}/link`, { device_id }),
    onSuccess: () => {
      toast.ok('Vínculo atualizado.');
      setLinking(null);
      qc.invalidateQueries({ queryKey: ['wg-peers'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: toast.err,
  });

  const rows = useMemo(() => {
    const t = search.toLowerCase();
    return (peers.data?.peers ?? []).filter((p: any) =>
      (showRemoved || p.present) &&
      (!state || p.state === state) &&
      (!link || (link === 'linked' ? !!p.device_id : !p.device_id)) &&
      (!t || [p.name, p.comment, p.allowed_address, p.current_endpoint_address, p.endpoint_address, p.device_name, p.client_name, p.interface, p.public_key].join(' ').toLowerCase().includes(t)),
    );
  }, [peers.data, search, state, link, showRemoved]);
  const paged = usePaged(rows, 25);

  if (peers.isLoading) return <PageSkeleton />;
  if (peers.error) return <ErrorBox error={peers.error} />;
  const data = peers.data;

  if (!data.central) {
    return (
      <div className="space-y-4">
        <PageHeader title="Peers WireGuard" />
        <Notice kind="info">
          A MikroTik central ainda não foi cadastrada. Cadastre-a em <b>Equipamentos</b> marcando “Esta é a MikroTik central” nas opções avançadas.
        </Notice>
        {can('devices.manage') && <Button variant="primary" onClick={() => setCreating({ is_central: true, name: 'MikroTik Central' })}><Plus className="size-4" /> Cadastrar central</Button>}
        <DeviceForm open={!!creating} initial={creating} onClose={() => setCreating(undefined)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Peers WireGuard"
        subtitle={<>Central: <b>{data.central.name}</b> ({data.central.host}) · RouterOS {data.central.ros_version ?? '?'}</>}
        actions={<Button className="w-full sm:w-auto" onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw className="size-4" /> Ler da central agora</Button>}
      />
      {data.sync && <Freshness collectedAt={data.sync.collectedAt} stale={data.sync.stale} error={data.sync.error} />}
      <Notice kind="info">
        “Handshake” mostra o estado do <b>túnel</b> visto pela central. A coluna “Gerência” mostra se o sistema conseguiu acessar a MikroTik remota pela API — são verificações independentes.
      </Notice>

      <Card
        bodyClass=""
        title={`${rows.length} peers`}
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Nome, IP, cliente, chave…" className="w-full sm:w-60" />
            <Select value={state} onChange={(e) => setState(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-48">
              <option value="">Estado: todos</option>
              <option value="recent">Handshake recente</option>
              <option value="stale">Sem handshake recente</option>
              <option value="never">Sem handshake</option>
              <option value="disabled">Desabilitado</option>
            </Select>
            <Select value={link} onChange={(e) => setLink(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-40">
              <option value="">Vínculo: todos</option>
              <option value="linked">Vinculados</option>
              <option value="unlinked">Sem vínculo</option>
            </Select>
            <Checkbox label="Mostrar removidos" checked={showRemoved} onChange={setShowRemoved} />
          </>
        }
      >
        {rows.length === 0 ? <Empty>Nenhum peer encontrado.</Empty> : (
          <>
            <DataList
              rows={paged.slice}
              rowKey={(p: any) => p.id}
              rowClass={(p: any) => (p.present ? undefined : 'opacity-50')}
              accent={(p: any) => ({ recent: 'green', stale: 'amber', never: 'slate', disabled: 'red' } as const)[p.state as 'recent'] ?? 'slate'}
              cols={[
                {
                  key: 'peer', header: 'Peer', mobile: 'title',
                  cell: (p: any) => (
                    <div>
                      <div className="font-medium">{p.name || p.comment || <span className="text-slate-400">(sem nome)</span>}</div>
                      {p.name && p.comment && <div className="text-xs font-normal text-slate-500">{p.comment}</div>}
                      <div className="mono hidden max-w-40 truncate text-slate-400 md:block" title={p.public_key}>{p.public_key}</div>
                    </div>
                  ),
                },
                {
                  key: 'device', header: 'Equipamento / cliente', mobile: 'subtitle',
                  cell: (p: any) => p.device_id ? (
                    <Link to={`/equipamentos/${p.device_id}`} className="text-brand-700 hover:underline">
                      <span className="font-medium">{p.device_name}</span>
                      <span className="block text-xs text-slate-500 max-md:inline max-md:before:content-['_·_']">{p.client_name ?? '—'}</span>
                    </Link>
                  ) : <span className="text-xs text-slate-400">não vinculado</span>,
                },
                {
                  key: 'state', header: 'Último handshake', mobile: 'badges',
                  cell: (p: any) => {
                    const age = handshakeAge(p);
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 md:block">
                        <PeerStateBadge state={p.state} />
                        <span className="text-xs text-slate-500 md:mt-1 md:block">{age == null ? 'nunca' : `há ${fmtDuration(age)}`}</span>
                        {!p.present && <Badge color="red">removido da central</Badge>}
                      </div>
                    );
                  },
                },
                { key: 'mgmt', header: 'Gerência', mobile: 'badges', cell: (p: any) => (p.device_id ? <DeviceStatusBadge status={p.device_status} title={p.device_status_message} /> : null) },
                { key: 'allowed', header: 'Allowed address', label: 'Allowed', cell: (p: any) => <span className="mono">{(p.allowed_address ?? '').split(',').map((a: string) => <span key={a} className="block">{a}</span>)}</span> },
                { key: 'current', header: 'Endpoint atual', cell: (p: any) => <span className="mono">{endpoint(p.current_endpoint_address, p.current_endpoint_port)}</span> },
                { key: 'endpoint', header: 'Endpoint configurado', label: 'Endpoint fixo', cell: (p: any) => <span className="mono">{endpoint(p.endpoint_address, p.endpoint_port)}</span> },
                { key: 'traffic', header: 'Rx / Tx', label: 'Tráfego', cell: (p: any) => <span className="whitespace-nowrap text-xs">↓ {fmtBytes(p.rx_bytes)} <br className="max-md:hidden" />↑ {fmtBytes(p.tx_bytes)}</span> },
                { key: 'iface', header: 'Interface', cell: (p: any) => <span className="text-xs">{p.interface}</span> },
                {
                  key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                  cell: (p: any) => (
                    <>
                      {can('wireguard.link') && (
                        <IconButton icon={Link2} label="Vincular a equipamento" onClick={() => { setLinking(p); setLinkDevice(p.device_id ? String(p.device_id) : ''); }} />
                      )}
                      {!p.device_id && can('devices.manage') && (
                        <IconButton icon={Plus} label="Cadastrar equipamento a partir deste peer" onClick={() => setCreating({ name: p.name || p.comment || '', host: p.suggested_host ?? '', wg_peer_id: p.id })} />
                      )}
                    </>
                  ),
                },
              ]}
            />
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </Card>

      <Modal
        open={!!linking}
        onClose={() => setLinking(null)}
        title="Vincular peer a equipamento"
        footer={
          <>
            {linking?.device_id && (
              <Button variant="danger" onClick={() => saveLink.mutate({ id: linking.id, device_id: null })} loading={saveLink.isPending}>
                <Unlink className="size-4" /> Desvincular
              </Button>
            )}
            <Button onClick={() => setLinking(null)}>Cancelar</Button>
            <Button variant="primary" disabled={!linkDevice} loading={saveLink.isPending} onClick={() => saveLink.mutate({ id: linking.id, device_id: Number(linkDevice) })}>
              Salvar vínculo
            </Button>
          </>
        }
      >
        {linking && (
          <div className="space-y-3 text-sm">
            <div>Peer: <b>{linking.name || linking.comment || linking.public_key}</b> — <span className="mono">{linking.allowed_address}</span></div>
            <Field label="Equipamento">
              <Select value={linkDevice} onChange={(e) => setLinkDevice(e.target.value)}>
                <option value="">Selecione…</option>
                {(devices.data ?? []).filter((d: any) => !d.is_central).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.client_name ? `${d.client_name} — ` : ''}{d.name} ({d.host})</option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-500">O vínculo é registrado apenas no sistema; nada é alterado na central.</p>
          </div>
        )}
      </Modal>

      <DeviceForm open={!!creating} initial={creating} onClose={() => setCreating(undefined)} />
    </div>
  );
}
