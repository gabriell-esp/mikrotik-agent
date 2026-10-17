import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CheckCircle2, History, Link2, LogOut, MessageCircle, Pencil, Plus, QrCode, Send, Server, Smartphone, Trash2, Users, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Select,
  Skeleton, Switch, TableSkeleton, useToast,
} from '../components/ui';
import DataList from '../components/DataList';
import RowActions from '../components/RowActions';
import { del, get, post, put } from '../lib/api';
import { fmtDateTime } from '../lib/format';

const STATUS: Record<string, { label: string; color: 'green' | 'amber' | 'red' | 'slate' | 'blue' }> = {
  CONNECTED: { label: 'Conectado', color: 'green' },
  QRCODE: { label: 'Aguardando leitura do QR code', color: 'amber' },
  INITIALIZING: { label: 'Iniciando sessão…', color: 'blue' },
  CLOSED: { label: 'Desconectado', color: 'slate' },
  NOT_CONFIGURED: { label: 'Não configurado', color: 'slate' },
  ERROR: { label: 'Servidor indisponível', color: 'red' },
};

export function fmtTarget(target: string, isGroup: boolean): string {
  if (isGroup) return `Grupo ${target.slice(0, 6)}…${target.slice(-4)}`;
  const m = target.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${target}`;
}

const DELAYS = [
  { v: 0, l: 'Imediatamente' },
  { v: 60, l: 'Após 1 minuto' },
  { v: 120, l: 'Após 2 minutos (recomendado)' },
  { v: 300, l: 'Após 5 minutos' },
  { v: 600, l: 'Após 10 minutos' },
  { v: 1800, l: 'Após 30 minutos' },
];

// ------------------------------------------------------------- conexão

function ConnectionCard({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [polling, setPolling] = useState(false);
  const st = useQuery({
    queryKey: ['wa-status'],
    queryFn: () => get('/notifications/whatsapp/status'),
    refetchInterval: polling ? 3000 : false,
  });
  const status = st.data?.status ?? 'CLOSED';
  useEffect(() => {
    if (status === 'CONNECTED' && polling) {
      setPolling(false);
      toast.ok('WhatsApp conectado.');
    }
  }, [status, polling, toast]);

  const start = useMutation({
    mutationFn: () => post('/notifications/whatsapp/start'),
    onSuccess: (r) => {
      qc.setQueryData(['wa-status'], { configured: true, ...r });
      setPolling(true);
    },
    onError: toast.err,
  });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logout = useMutation({
    mutationFn: () => post('/notifications/whatsapp/logout'),
    onSuccess: () => {
      setConfirmLogout(false);
      toast.ok('Sessão do WhatsApp desconectada.');
      qc.invalidateQueries({ queryKey: ['wa-status'] });
    },
    onError: toast.err,
  });

  const s = STATUS[status] ?? { label: status, color: 'slate' as const };
  return (
    <Card title="Conexão com o WhatsApp" icon={Smartphone} actions={<Badge color={s.color} dot>{s.label}</Badge>}>
      {st.isLoading ? (
        <Skeleton className="h-40" />
      ) : !st.data?.configured ? (
        <Empty icon={Server}>Configure o servidor WPPConnect ao lado para conectar um número.</Empty>
      ) : status === 'CONNECTED' ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50"><CheckCircle2 className="size-7 text-emerald-600" /></div>
          <div>
            <div className="font-medium text-slate-800">Número conectado</div>
            <div className="text-sm text-slate-500">Sessão <b>{settings.session}</b> pronta para enviar alertas.</div>
          </div>
          <Button variant="ghost" onClick={() => setConfirmLogout(true)}><LogOut className="size-4" /> Desconectar número</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {st.data?.error && <ErrorBox error={new Error(st.data.error)} title="Falha ao consultar o WPPConnect" />}
          {st.data?.qrcode ? (
            <div className="flex flex-col items-center gap-3">
              <img src={st.data.qrcode} alt="QR code para conectar o WhatsApp" className="size-56 rounded-xl border border-slate-200 p-2" />
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>No celular, abra o WhatsApp → <b>Aparelhos conectados</b>.</li>
                <li>Toque em <b>Conectar um aparelho</b> e leia o código.</li>
                <li>Esta tela confirma automaticamente.</li>
              </ol>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-slate-100"><QrCode className="size-7 text-slate-400" /></div>
              <p className="max-w-xs text-sm text-slate-500">
                {polling || status === 'INITIALIZING' ? 'Gerando o QR code…' : 'Inicie a sessão para gerar o QR code e vincular o número que enviará os alertas.'}
              </p>
            </div>
          )}
          <div className="flex justify-center">
            <Button variant="primary" onClick={() => start.mutate()} loading={start.isPending}>
              <Link2 className="size-4" /> {st.data?.qrcode ? 'Gerar novo QR code' : 'Conectar WhatsApp'}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={() => logout.mutate()}
        loading={logout.isPending}
        title="Desconectar WhatsApp"
        confirmLabel="Desconectar"
        message="Os alertas deixarão de ser enviados até que um número seja conectado novamente."
      />
    </Card>
  );
}

// ------------------------------------------------------------- configuração do servidor

function SettingsCard({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setF({ enabled: settings.enabled, base_url: settings.base_url, session: settings.session, secret_key: '', delay_sec: settings.delay_sec, resource_threshold: settings.resource_threshold });
  }, [settings]);
  const save = useMutation({
    mutationFn: () => put('/notifications/settings', { ...f, secret_key: f.secret_key || undefined }),
    onSuccess: () => {
      setError(null);
      toast.ok('Configuração salva.');
      qc.invalidateQueries({ queryKey: ['wa-settings'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
    },
    onError: setError,
  });
  if (!f) return null;
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Card title="Servidor e regras" icon={Server} actions={<Switch checked={f.enabled} onChange={(v) => set('enabled', v)} label={f.enabled ? 'Envio ativo' : 'Envio pausado'} />}>
      <div className="space-y-4">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="URL do WPPConnect Server" hint="No Docker Compose: http://wppconnect:21465" className="sm:col-span-2">
            <Input value={f.base_url} onChange={(e) => set('base_url', e.target.value.trim())} className="mono" />
          </Field>
          <Field label="Nome da sessão">
            <Input value={f.session} onChange={(e) => set('session', e.target.value.trim())} />
          </Field>
          <Field label="Chave secreta (SECRET_KEY)" hint={settings.has_secret_key ? 'Já configurada — preencha só para trocar.' : 'A mesma definida no WPPConnect Server.'}>
            <Input type="password" value={f.secret_key} onChange={(e) => set('secret_key', e.target.value)} autoComplete="new-password" placeholder={settings.has_secret_key ? '••••••••' : ''} />
          </Field>
          <Field label="Avisar mudança de status" hint="Evita alertas de quedas momentâneas.">
            <Select value={f.delay_sec} onChange={(e) => set('delay_sec', Number(e.target.value))}>
              {DELAYS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
            </Select>
          </Field>
          <Field label="Limite de CPU / memória / disco" hint="Alerta quando atingir este percentual.">
            <Select value={f.resource_threshold} onChange={(e) => set('resource_threshold', Number(e.target.value))}>
              {[80, 85, 90, 95].map((v) => <option key={v} value={v}>{v}%</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>Salvar configuração</Button>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------- destinatários

function RecipientForm({ open, onClose, recipient, events }: { open: boolean; onClose: () => void; recipient?: any; events: Record<string, string> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open });
  const [f, setF] = useState<any>({});
  const [error, setError] = useState<unknown>(null);
  const [loadGroups, setLoadGroups] = useState(false);
  const groups = useQuery({ queryKey: ['wa-groups'], queryFn: () => get('/notifications/whatsapp/groups'), enabled: open && loadGroups, meta: { live: false } });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadGroups(false);
    setF(
      recipient
        ? { ...recipient, all: recipient.client_ids == null, client_ids: recipient.client_ids ?? [] }
        : { name: '', target: '', is_group: false, enabled: true, events: ['device_down', 'device_up', 'device_auth'], all: true, client_ids: [] },
    );
  }, [open, recipient]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, target: f.target, is_group: f.is_group, enabled: f.enabled, events: f.events, client_ids: f.all ? null : f.client_ids };
      return recipient ? put(`/notifications/recipients/${recipient.id}`, body) : post('/notifications/recipients', body);
    },
    onSuccess: () => {
      toast.ok('Destinatário salvo.');
      qc.invalidateQueries({ queryKey: ['wa-recipients'] });
      onClose();
    },
    onError: setError,
  });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const toggle = (k: 'events' | 'client_ids', v: any, on: boolean) => set(k, on ? [...f[k], v] : f[k].filter((x: any) => x !== v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={recipient ? 'Editar destinatário' : 'Novo destinatário'}
      description="Quem recebe os alertas e sobre quais eventos e clientes."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}
    >
      <div className="space-y-5">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Plantão técnico" /></Field>
          <Field label="Tipo">
            <div className="flex h-9 rounded-lg bg-slate-100 p-1">
              {[{ v: false, l: 'Número', i: Smartphone }, { v: true, l: 'Grupo', i: Users }].map((o) => (
                <button key={o.l} type="button" onClick={() => set('is_group', o.v)}
                  className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium', f.is_group === o.v ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500')}>
                  <o.i className="size-4" /> {o.l}
                </button>
              ))}
            </div>
          </Field>
          {f.is_group ? (
            <Field label="Grupo" className="sm:col-span-2" hint="Carregue os grupos do número conectado ou cole o ID (ex.: 120363…@g.us).">
              <div className="flex gap-2">
                {groups.data?.length ? (
                  <Select value={f.target} onChange={(e) => set('target', e.target.value)}>
                    <option value="">Selecione…</option>
                    {groups.data.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                ) : (
                  <Input value={f.target ?? ''} onChange={(e) => set('target', e.target.value)} className="mono" placeholder="120363000000000000@g.us" />
                )}
                <Button onClick={() => (loadGroups ? groups.refetch() : setLoadGroups(true))} loading={groups.isFetching}>Carregar grupos</Button>
              </div>
              {groups.error && <span className="mt-1 block text-xs text-red-600">{(groups.error as Error).message}</span>}
            </Field>
          ) : (
            <Field label="Número do WhatsApp" className="sm:col-span-2" hint="Com DDD. O DDI 55 é incluído automaticamente.">
              <Input value={f.target ?? ''} onChange={(e) => set('target', e.target.value)} placeholder="(11) 91234-5678" inputMode="tel" />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-slate-700">Eventos</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(events).map(([k, label]) => (
              <Checkbox key={k} label={label} checked={f.events?.includes(k)} onChange={(v) => toggle('events', k, v)} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-slate-700">Clientes</div>
          <Checkbox label="Todos os clientes (inclui a MikroTik central)" checked={!!f.all} onChange={(v) => set('all', v)} />
          {!f.all && (
            <div className="mt-2 grid max-h-44 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {(clients.data ?? []).map((c: any) => (
                <Checkbox key={c.id} label={c.name} checked={f.client_ids?.includes(c.id)} onChange={(v) => toggle('client_ids', c.id, v)} />
              ))}
              {!clients.data?.length && <span className="text-xs text-slate-500">Nenhum cliente cadastrado.</span>}
            </div>
          )}
        </div>
        <Switch checked={!!f.enabled} onChange={(v) => set('enabled', v)} label="Destinatário ativo" />
      </div>
    </Modal>
  );
}

function RecipientsCard({ events, connected }: { events: Record<string, string>; connected: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rec = useQuery({ queryKey: ['wa-recipients'], queryFn: () => get('/notifications/recipients') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients') });
  const [form, setForm] = useState<{ open: boolean; r?: any }>({ open: false });
  const [removing, setRemoving] = useState<any>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const test = async (r: any) => {
    setTesting(r.id);
    try {
      await post('/notifications/test', { recipient_id: r.id });
      toast.ok(`Mensagem de teste enviada para ${r.name}.`);
    } catch (e) {
      toast.err(e);
    } finally {
      setTesting(null);
      qc.invalidateQueries({ queryKey: ['wa-log'] });
    }
  };
  const remove = useMutation({
    mutationFn: () => del(`/notifications/recipients/${removing.id}`),
    onSuccess: () => {
      toast.ok('Destinatário removido.');
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['wa-recipients'] });
    },
    onError: toast.err,
  });
  const clientName = (id: number) => clients.data?.find((c: any) => c.id === id)?.name ?? `#${id}`;

  return (
    <Card
      title="Destinatários"
      icon={Users}
      subtitle="Números e grupos que recebem os alertas"
      bodyClass=""
      actions={<Button variant="primary" className="w-full sm:w-auto" onClick={() => setForm({ open: true })}><Plus className="size-4" /> Adicionar</Button>}
    >
      {rec.isLoading ? <TableSkeleton cols={5} rows={3} /> : !rec.data?.length ? (
        <Empty icon={MessageCircle}>Nenhum destinatário. Adicione o número do plantão ou o grupo da equipe.</Empty>
      ) : (
        <>
          <DataList
            rows={rec.data}
            rowKey={(r: any) => r.id}
            accent={(r: any) => (r.enabled ? 'green' : 'slate')}
            cols={[
              {
                key: 'name', header: 'Destinatário', mobile: 'title',
                cell: (r: any) => (
                  <div>
                    <div className="flex items-center gap-2 font-medium text-slate-900">
                      {r.is_group ? <Users className="size-4 shrink-0 text-slate-400" /> : <Smartphone className="size-4 shrink-0 text-slate-400" />}
                      {r.name}
                    </div>
                    <div className="mono font-normal">{fmtTarget(r.target, r.is_group)}</div>
                  </div>
                ),
              },
              { key: 'status', header: 'Situação', mobile: 'badges', cell: (r: any) => (r.enabled ? <Badge color="green" dot>Ativo</Badge> : <Badge dot>Pausado</Badge>) },
              {
                key: 'events', header: 'Eventos', mobile: 'full',
                cell: (r: any) => <div className="flex max-w-md flex-wrap gap-1">{r.events.map((e: string) => <Badge key={e} color="blue">{events[e] ?? e}</Badge>)}</div>,
              },
              { key: 'clients', header: 'Clientes', cell: (r: any) => <span className="text-xs">{r.client_ids == null ? 'Todos' : r.client_ids.map(clientName).join(', ')}</span> },
              {
                key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                cell: (r: any) => (
                  <RowActions
                    title={r.name}
                    actions={[
                      { icon: Send, label: testing === r.id ? 'Enviando teste…' : 'Enviar mensagem de teste', short: 'Enviar teste', onClick: () => (connected ? void test(r) : toast.err('Conecte o WhatsApp antes de enviar o teste.')) },
                      { icon: Pencil, label: 'Editar', onClick: () => setForm({ open: true, r }) },
                      { icon: Trash2, label: 'Remover', tone: 'danger', onClick: () => setRemoving(r) },
                    ]}
                  />
                ),
              },
            ]}
          />

        </>
      )}
      <RecipientForm open={form.open} recipient={form.r} events={events} onClose={() => setForm({ open: false })} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Remover destinatário"
        confirmLabel="Remover"
        message={<><b>{removing?.name}</b> deixará de receber alertas.</>}
      />
    </Card>
  );
}

// ------------------------------------------------------------- histórico

function LogCard({ events }: { events: Record<string, string> }) {
  const [page, setPage] = useState(1);
  const log = useQuery({ queryKey: ['wa-log', page], queryFn: () => get('/notifications/log', { page }), placeholderData: keepPreviousData });
  const [open, setOpen] = useState<any>(null);
  return (
    <Card title="Histórico de envios" icon={History} bodyClass="">
      {log.isLoading ? <TableSkeleton cols={4} rows={4} /> : !log.data?.rows.length ? <Empty icon={History}>Nenhuma mensagem enviada ainda.</Empty> : (
        <>
          <DataList
            rows={log.data.rows}
            rowKey={(r: any) => r.id}
            onRowClick={setOpen}
            accent={(r: any) => (r.success ? 'green' : 'red')}
            cols={[
              { key: 'to', header: 'Destinatário', mobile: 'title', cell: (r: any) => <div>{r.recipient_name}<div className="mono font-normal">{r.target}</div></div> },
              { key: 'at', header: 'Quando', mobile: 'subtitle', td: 'whitespace-nowrap text-xs', cell: (r: any) => <span className="text-xs">{fmtDateTime(r.at)}</span> },
              {
                key: 'events', header: 'Assunto', mobile: 'badges',
                cell: (r: any) => <div className="flex flex-wrap gap-1">{r.events.map((e: string) => <Badge key={e}>{e === 'test' ? 'Teste' : events[e] ?? e}</Badge>)}</div>,
              },
              {
                key: 'result', header: 'Resultado', mobile: 'badges',
                cell: (r: any) => r.success
                  ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" /> Enviado{r.attempts > 1 ? ` (${r.attempts} tentativas)` : ''}</span>
                  : <span className="inline-flex items-center gap-1 text-xs text-red-700" title={r.error}><XCircle className="size-3.5" /> Falhou</span>,
              },
            ]}
          />

          <Pagination page={log.data.page} pageSize={log.data.page_size} total={log.data.total} onPage={setPage} />
        </>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Mensagem enviada" description={open && `${fmtDateTime(open.at)} · ${open.recipient_name}`}>
        {open && (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#e7ffdb] p-4 text-sm whitespace-pre-wrap text-slate-800 shadow-xs">{open.message}</div>
            {open.error && <ErrorBox error={new Error(open.error)} title={`Falhou após ${open.attempts} tentativa(s)`} />}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function NotificationsPage() {
  const settings = useQuery({ queryKey: ['wa-settings'], queryFn: () => get('/notifications/settings') });
  const status = useQuery({ queryKey: ['wa-status'], queryFn: () => get('/notifications/whatsapp/status') });
  if (settings.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  const s = settings.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificações"
        subtitle="Alertas de queda, retorno e recursos das MikroTiks pelo WhatsApp (WPPConnect)."
        actions={<Badge color={s.enabled ? 'green' : 'slate'} dot>{s.enabled ? 'Envio ativo' : 'Envio pausado'}</Badge>}
      />
      {!s.enabled && s.has_secret_key && <Notice>O envio está pausado: os alertas são avaliados, mas nenhuma mensagem é enviada.</Notice>}
      <div className="grid gap-6 xl:grid-cols-2">
        <ConnectionCard settings={s} />
        <SettingsCard settings={s} />
      </div>
      <RecipientsCard events={s.events} connected={!!status.data?.connected} />
      <LogCard events={s.events} />
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <BellRing className="size-3.5" />
        Cada equipamento gera no máximo um aviso por mudança de status; vários alertas no mesmo ciclo são agrupados em uma só mensagem.
      </p>
    </div>
  );
}
