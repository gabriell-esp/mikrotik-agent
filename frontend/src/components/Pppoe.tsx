import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Pencil, Plus, Power, PowerOff, RefreshCw, Trash2, Unplug, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { IconButton,
  Badge, Button, Card, Checkbox, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, Notice, Pagination, SearchBox, Select, Spinner, TableSkeleton, useToast,
} from './ui';

const SERVICES = ['pppoe', 'any', 'pptp', 'l2tp', 'ovpn', 'sstp'];

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}

const pathId = (id: string) => encodeURIComponent(id);

// ---------- Formulário de secret ----------
function SecretForm({ open, onClose, deviceId, secret, devices }: { open: boolean; onClose: () => void; deviceId?: number; secret?: any; devices?: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!secret;
  const [dev, setDev] = useState<number | undefined>(deviceId);
  const [f, setF] = useState<any>({});
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDev(secret?.device_id ?? deviceId);
    setF(
      secret
        ? { name: secret.name, password: '', service: secret.service || 'pppoe', profile: secret.profile ?? '', local_address: secret.local_address, remote_address: secret.remote_address,
            caller_id: secret.caller_id, comment: secret.comment, disabled: secret.disabled }
        : { name: '', password: genPassword(), service: 'pppoe', profile: '', local_address: '', remote_address: '', caller_id: '', comment: '', disabled: false },
    );
  }, [open, secret, deviceId]);

  const profiles = useQuery({ queryKey: ['ppp-profiles', dev], queryFn: () => get(`/devices/${dev}/pppoe/profiles`), enabled: open && !!dev, meta: { live: false } });
  useEffect(() => {
    if (!editing && profiles.data?.profiles?.length && !f.profile) {
      const def = profiles.data.profiles.find((p: any) => p.name !== 'default' && p.name !== 'default-encryption') ?? profiles.data.profiles[0];
      setF((x: any) => ({ ...x, profile: def.name }));
    }
  }, [profiles.data, editing, f.profile]);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? put(`/devices/${dev}/pppoe/secrets/${pathId(secret.id)}`, { ...f, expected_name: secret.name })
        : post(`/devices/${dev}/pppoe/secrets`, f),
    onSuccess: () => {
      toast.ok(editing ? 'Secret atualizado no equipamento.' : 'Secret criado no equipamento.');
      qc.invalidateQueries({ queryKey: ['ppp'] });
      onClose();
    },
    onError: setError,
  });

  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const selectedProfile = profiles.data?.profiles?.find((p: any) => p.name === f.profile);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Editar secret: ${secret.name}` : 'Novo secret PPPoE'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!dev} onClick={() => save.mutate()}>Salvar no equipamento</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorBox error={error} title="O equipamento não aceitou a alteração" /></div>
        {!deviceId && !editing && (
          <Field label="Equipamento" className="sm:col-span-2">
            <Select value={dev ?? ''} onChange={(e) => { setDev(e.target.value ? Number(e.target.value) : undefined); set('profile', ''); }}>
              <option value="">Selecione…</option>
              {(devices ?? []).map((d: any) => <option key={d.device_id} value={d.device_id}>{d.client_name ? `${d.client_name} — ` : ''}{d.device_name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Usuário"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value.trim())} autoComplete="off" /></Field>
        <Field label={editing ? 'Nova senha (deixe em branco para manter)' : 'Senha'}>
          <div className="flex gap-1">
            <Input value={f.password ?? ''} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" className="mono" />
            <Button type="button" title="Gerar senha" onClick={() => set('password', genPassword())}><Wand2 className="size-4" /></Button>
          </div>
        </Field>
        <Field label="Perfil" hint={selectedProfile ? `Rate limit: ${selectedProfile.rate_limit || '—'} · local: ${selectedProfile.local_address || '—'} · remoto: ${selectedProfile.remote_address || '—'}` : undefined}>
          {profiles.isLoading && dev ? <Input disabled value="Carregando perfis…" /> : (
            <Select value={f.profile ?? ''} onChange={(e) => set('profile', e.target.value)}>
              <option value="">Selecione…</option>
              {(profiles.data?.profiles ?? []).map((p: any) => <option key={p.name} value={p.name}>{p.name}{p.rate_limit ? ` (${p.rate_limit})` : ''}</option>)}
            </Select>
          )}
          {profiles.data && !profiles.data.available && <span className="text-xs text-red-600">{profiles.data.reason}</span>}
          {profiles.error && <span className="text-xs text-red-600">{(profiles.error as Error).message}</span>}
        </Field>
        <Field label="Serviço">
          <Select value={f.service ?? 'pppoe'} onChange={(e) => set('service', e.target.value)}>
            {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Endereço local (opcional)" hint="Vazio = usa o do perfil."><Input value={f.local_address ?? ''} onChange={(e) => set('local_address', e.target.value.trim())} className="mono" /></Field>
        <Field label="Endereço remoto (opcional)" hint="IP fixo do cliente. Vazio = pool do perfil."><Input value={f.remote_address ?? ''} onChange={(e) => set('remote_address', e.target.value.trim())} className="mono" /></Field>
        <Field label="Caller ID / MAC (opcional)"><Input value={f.caller_id ?? ''} onChange={(e) => set('caller_id', e.target.value.trim())} className="mono" placeholder="AA:BB:CC:DD:EE:FF" /></Field>
        <Field label="Comentário"><Input value={f.comment ?? ''} onChange={(e) => set('comment', e.target.value)} placeholder="Ex.: Apto 101 – Bloco A – Maria Silva" /></Field>
        <Checkbox label="Criar/manter desabilitado" checked={!!f.disabled} onChange={(v) => set('disabled', v)} />
      </div>
    </Modal>
  );
}

// ---------- Lista de secrets ----------
export function SecretsList({ deviceId, initialSearch = '' }: { deviceId?: number; initialSearch?: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [devFilter, setDevFilter] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);
  useEffect(() => setPage(1), [term, status, clientId, devFilter]);

  const q = useQuery({
    queryKey: ['ppp', 'secrets', deviceId, term, status, clientId, devFilter, page],
    queryFn: () => get('/pppoe/secrets', { search: term, status, client_id: clientId, device_id: deviceId ?? devFilter, page, page_size: 50 }),
    placeholderData: keepPreviousData,
  });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: !deviceId && can('clients.view') });

  const [form, setForm] = useState<{ open: boolean; secret?: any }>({ open: false });
  const [pw, setPw] = useState<{ secret: any; password?: string; loading: boolean; error?: unknown } | null>(null);
  const [toggle, setToggle] = useState<any>(null);
  const [disconnect, setDisconnect] = useState(true);
  const [removing, setRemoving] = useState<any>(null);

  const refresh = useMutation({
    mutationFn: () => post('/pppoe/refresh', deviceId ? { device_id: deviceId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ppp'] }),
    onError: toast.err,
  });

  const showPassword = async (s: any) => {
    setPw({ secret: s, loading: true });
    try {
      const r = await post(`/devices/${s.device_id}/pppoe/secrets/${pathId(s.id)}/password`, { expected_name: s.name });
      setPw({ secret: s, password: r.password, loading: false });
    } catch (e) {
      setPw({ secret: s, loading: false, error: e });
    }
  };

  const doToggle = useMutation({
    mutationFn: () => post(`/devices/${toggle.device_id}/pppoe/secrets/${pathId(toggle.id)}/toggle`, {
      expected_name: toggle.name, disabled: !toggle.disabled, disconnect: !toggle.disabled && disconnect && toggle.connected && can('pppoe.disconnect'),
    }),
    onSuccess: (r) => {
      toast.ok(`${toggle.disabled ? 'Habilitado' : 'Desabilitado'}: ${toggle.name}${r.disconnected ? ' (sessão desconectada)' : ''}`);
      setToggle(null);
      qc.invalidateQueries({ queryKey: ['ppp'] });
    },
    onError: toast.err,
  });

  const doRemove = useMutation({
    mutationFn: () => del(`/devices/${removing.device_id}/pppoe/secrets/${pathId(removing.id)}`, { expected_name: removing.name, confirm: removing.name }),
    onSuccess: () => {
      toast.ok(`Secret ${removing.name} excluído.`);
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['ppp'] });
    },
    onError: toast.err,
  });

  const data = q.data;
  const unavailable = (data?.devices ?? []).filter((d: any) => d.unavailable || d.stale);

  return (
    <div className="space-y-3">
      <Card
        bodyClass=""
        title={data ? `${data.total} usuário(s)` : 'Secrets'}
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Usuário, comentário, IP, cliente…" className="w-full sm:w-64" />
            {!deviceId && can('clients.view') && (
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full sm:w-44">
                <option value="">Todos os clientes</option>
                {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
            {!deviceId && (
              <Select value={devFilter} onChange={(e) => setDevFilter(e.target.value)} className="w-full sm:w-44">
                <option value="">Todos os equipamentos</option>
                {(data?.devices ?? []).map((d: any) => <option key={d.device_id} value={d.device_id}>{d.device_name}</option>)}
              </Select>
            )}
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-40">
              <option value="">Todos</option>
              <option value="enabled">Habilitados</option>
              <option value="disabled">Desabilitados</option>
              <option value="connected">Conectados</option>
              <option value="disconnected">Desconectados</option>
            </Select>
            <Button onClick={() => refresh.mutate()} loading={refresh.isPending} title="Consultar os equipamentos agora"><RefreshCw className="size-4" /> Atualizar</Button>
            {can('pppoe.create') && <Button variant="primary" onClick={() => setForm({ open: true })}><Plus className="size-4" /> Novo</Button>}
          </>
        }
      >
        {unavailable.length > 0 && (
          <div className="border-b border-slate-200 p-3">
            <Notice>
              <div className="font-medium">Alguns dados podem estar desatualizados:</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {unavailable.slice(0, 8).map((d: any) => (
                  <li key={d.device_id}>
                    {d.device_name}: {d.unavailable ?? d.error ?? (d.collectedAt ? `última coleta em ${fmtDateTime(d.collectedAt)}` : 'ainda não coletado')}
                  </li>
                ))}
                {unavailable.length > 8 && <li>e mais {unavailable.length - 8}…</li>}
              </ul>
            </Notice>
          </div>
        )}
        {q.isLoading ? <TableSkeleton cols={6} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !data.rows.length ? <Empty>Nenhum secret encontrado.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Usuário</th>{!deviceId && <th>Equipamento / cliente</th>}<th>Perfil</th><th>Serviço</th><th>Endereços</th><th>Estado</th><th>Comentário</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s: any) => (
                  <tr key={`${s.device_id}:${s.id}`} className={s.disabled ? 'text-slate-400' : ''}>
                    <td className="font-medium">
                      {s.name}
                      {s.caller_id && <div className="mono text-slate-400">MAC {s.caller_id}</div>}
                    </td>
                    {!deviceId && (
                      <td>
                        <Link to={`/pppoe/${s.device_id}`} className="text-brand-700 hover:underline">{s.device_name}</Link>
                        <div className="text-xs text-slate-500">{s.client_name ?? '—'}</div>
                      </td>
                    )}
                    <td>{s.profile}</td>
                    <td className="text-xs">{s.service}</td>
                    <td className="mono">{s.remote_address || <span className="text-slate-300">pool</span>}{s.local_address && <div className="text-slate-400">local {s.local_address}</div>}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      {s.disabled ? <Badge color="red">Desabilitado</Badge> : <Badge color="green">Habilitado</Badge>}
                      {s.connected ? <Badge color="blue">Conectado</Badge> : <Badge>Desconectado</Badge>}
                      {s.stale && <Badge color="amber">desatualizado</Badge>}
                    </td>
                    <td className="max-w-56 break-words text-xs">{s.comment}</td>
                    <td className="whitespace-nowrap text-right">
                      {can('pppoe.password') && <IconButton icon={Eye} label="Ver senha (registrado na auditoria)" onClick={() => showPassword(s)} />}
                      {can('pppoe.edit') && <IconButton icon={Pencil} label="Editar" onClick={() => setForm({ open: true, secret: s })} />}
                      {can('pppoe.toggle') && (
                        <IconButton icon={s.disabled ? Power : PowerOff} label={s.disabled ? 'Habilitar' : 'Desabilitar'} tone={s.disabled ? 'success' : 'warning'} onClick={() => { setDisconnect(true); setToggle(s); }} />
                      )}
                      {can('pppoe.delete') && <IconButton icon={Trash2} label="Excluir" tone="danger" onClick={() => setRemoving(s)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>

      <SecretForm open={form.open} onClose={() => setForm({ open: false })} deviceId={deviceId} secret={form.secret} devices={data?.devices} />

      <Modal open={!!pw} onClose={() => setPw(null)} title={`Senha de ${pw?.secret.name}`}>
        {pw?.loading ? <Spinner label="Consultando o equipamento…" /> : pw?.error ? <ErrorBox error={pw.error} /> : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-slate-100 px-3 py-2 font-mono text-base">{pw?.password}</code>
              <Button onClick={() => { navigator.clipboard?.writeText(pw?.password ?? ''); toast.ok('Senha copiada.'); }}><Copy className="size-4" /> Copiar</Button>
            </div>
            <p className="text-xs text-slate-500">Esta visualização foi registrada na auditoria.</p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toggle}
        onClose={() => setToggle(null)}
        onConfirm={() => doToggle.mutate()}
        loading={doToggle.isPending}
        danger={!toggle?.disabled}
        title={toggle?.disabled ? 'Habilitar secret' : 'Desabilitar secret'}
        confirmLabel={toggle?.disabled ? 'Habilitar' : 'Desabilitar'}
        message={<>{toggle?.disabled ? 'Habilitar' : 'Desabilitar'} o usuário <b>{toggle?.name}</b> em <b>{toggle?.device_name}</b>?</>}
      >
        {toggle && !toggle.disabled && toggle.connected && can('pppoe.disconnect') && (
          <Checkbox label="Desconectar também a sessão ativa (sem isso o cliente continua conectado até cair)" checked={disconnect} onChange={setDisconnect} />
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => doRemove.mutate()}
        loading={doRemove.isPending}
        title="Excluir secret PPPoE"
        confirmLabel="Excluir definitivamente"
        message={<>O usuário <b>{removing?.name}</b> será removido de <b>{removing?.device_name}</b>. Esta ação não pode ser desfeita pelo sistema.</>}
        confirmText={removing?.name}
      />
    </div>
  );
}

// ---------- Sessões ativas ----------
export function ActiveSessions({ deviceId }: { deviceId?: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);
  useEffect(() => setPage(1), [term]);
  const q = useQuery({
    queryKey: ['ppp', 'active', deviceId, term, page],
    queryFn: () => get('/pppoe/active', { search: term, device_id: deviceId, page, page_size: 50 }),
    placeholderData: keepPreviousData,
  });
  const [target, setTarget] = useState<any>(null);
  const refresh = useMutation({ mutationFn: () => post('/pppoe/refresh', deviceId ? { device_id: deviceId } : {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['ppp'] }), onError: toast.err });
  const disc = useMutation({
    mutationFn: () => del(`/devices/${target.device_id}/pppoe/active/${pathId(target.id)}`, { expected_name: target.name, confirm: target.name }),
    onSuccess: () => {
      toast.ok(`Sessão de ${target.name} desconectada.`);
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['ppp'] });
    },
    onError: toast.err,
  });

  return (
    <Card
      bodyClass=""
      title={q.data ? `${q.data.total} sessões ativas` : 'Sessões ativas'}
      actions={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Usuário, IP, MAC…" className="w-full sm:w-60" />
          <Button onClick={() => refresh.mutate()} loading={refresh.isPending}><RefreshCw className="size-4" /> Atualizar</Button>
        </>
      }
    >
      {q.isLoading ? <TableSkeleton cols={6} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !q.data.rows.length ? <Empty>Nenhuma sessão ativa.</Empty> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Usuário</th>{!deviceId && <th>Equipamento / cliente</th>}<th>Endereço</th><th>Caller ID</th><th>Uptime</th><th>Serviço</th><th></th></tr></thead>
            <tbody>
              {q.data.rows.map((a: any) => (
                <tr key={`${a.device_id}:${a.id}`}>
                  <td className="font-medium">{a.name} {a.stale && <Badge color="amber">desatualizado</Badge>}</td>
                  {!deviceId && <td><Link to={`/pppoe/${a.device_id}`} className="text-brand-700 hover:underline">{a.device_name}</Link><div className="text-xs text-slate-500">{a.client_name ?? '—'}</div></td>}
                  <td className="mono">{a.address}</td>
                  <td className="mono">{a.caller_id}</td>
                  <td>{a.uptime}</td>
                  <td className="text-xs">{a.service}{a.encoding ? ` · ${a.encoding}` : ''}</td>
                  <td className="text-right">
                    {can('pppoe.disconnect') && <IconButton icon={Unplug} label="Desconectar" tone="danger" onClick={() => setTarget(a)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={setPage} />
        </div>
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        onConfirm={() => disc.mutate()}
        loading={disc.isPending}
        title="Desconectar sessão"
        confirmLabel="Desconectar"
        message={<>Derrubar a sessão de <b>{target?.name}</b> ({target?.address}) em <b>{target?.device_name}</b>? O equipamento do cliente normalmente reconecta em seguida.</>}
        confirmText={target?.name}
      />
    </Card>
  );
}

