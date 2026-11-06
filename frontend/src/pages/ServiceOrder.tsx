import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Ban, Camera, CheckCircle2, ChevronRight, ClipboardList, Clock, History, ImagePlus, MapPin, Pause, Pencil, Phone, Play, Receipt, RotateCcw, Trash2, User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import RowActions from '../components/RowActions';
import ServiceOrderForm from '../components/ServiceOrderForm';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Field, IconButton, Input, Modal, Notice, PageHeader, PageSkeleton, Select, Textarea, useToast } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { fmtClock, fmtMoney, OS_PRIORITY, osNumber, preparePhoto, useWorkSeconds } from '../lib/os';
import { OsStatusBadge } from './ServiceOrders';

const EVENT: Record<string, string> = {
  criada: 'Ordem aberta', editada: 'Dados alterados', atribuida: 'Técnico alterado', iniciada: 'Serviço iniciado', retomada: 'Serviço retomado',
  pausada: 'Serviço pausado', concluida: 'Ordem concluída', reaberta: 'Ordem reaberta', cancelada: 'Ordem cancelada',
  gasto: 'Gasto lançado', gasto_removido: 'Gasto removido', foto: 'Foto enviada', foto_removida: 'Foto removida',
};

function eventDetail(e: any) {
  const d = e.details ?? {};
  if (e.kind === 'atribuida') return `${d.from ?? 'sem técnico'} → ${d.to ?? 'sem técnico'}`;
  if (e.kind === 'criada' && d.assigned) return `para ${d.assigned}`;
  if (e.kind === 'cancelada') return d.reason;
  if (e.kind === 'gasto' || e.kind === 'gasto_removido') return d.description;
  if (e.kind === 'foto') return d.caption;
  return null;
}

// ------------------------------------------------------------- cronômetro

function Timer({ o, onAction, busy }: { o: any; onAction: (a: 'start' | 'pause' | 'finish') => void; busy: string | null }) {
  const sec = useWorkSeconds(o);
  const running = o.status === 'em_andamento';
  const closed = ['concluida', 'cancelada'].includes(o.status);
  return (
    <div className={clsx('rounded-2xl border p-4 shadow-xs sm:p-5', running ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-white' : 'border-slate-200/80 bg-white')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <Clock className="size-3.5" /> Tempo trabalhado
            {running && <span className="ml-1 inline-flex items-center gap-1 text-brand-700 normal-case"><span className="size-2 animate-pulse rounded-full bg-brand-600" />cronômetro ligado</span>}
          </div>
          <div className={clsx('mt-1 font-mono text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl', running ? 'text-brand-700' : 'text-slate-900')}>{fmtClock(sec)}</div>
          <div className="mt-1 text-xs text-slate-500">
            {o.started_at ? <>Iniciada em {fmtDateTime(o.started_at)}</> : 'Ainda não iniciada'}
            {o.finished_at && <> · concluída em {fmtDateTime(o.finished_at)}</>}
          </div>
        </div>
        {o.can.execute && !closed && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {running ? (
              <Button className="h-11 px-5" onClick={() => onAction('pause')} loading={busy === 'pause'}><Pause className="size-4" /> Pausar</Button>
            ) : (
              <Button variant="primary" onClick={() => onAction('start')} loading={busy === 'start'} className={clsx('h-11 px-5', o.status === 'aberta' && 'col-span-2')}>
                <Play className="size-4" /> {o.started_at ? 'Retomar' : 'Iniciar serviço'}
              </Button>
            )}
            {o.status !== 'aberta' && (
              <Button className="h-11 px-5" variant={running ? 'primary' : 'secondary'} onClick={() => onAction('finish')}><CheckCircle2 className="size-4" /> Finalizar</Button>
            )}
          </div>
        )}
      </div>
      {!o.can.execute && !closed && (
        <p className="mt-3 text-xs text-slate-500">{o.assigned_name ? <>Somente <b>{o.assigned_name}</b> controla o cronômetro desta ordem.</> : 'Atribua um técnico para que a ordem possa ser iniciada.'}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- relatório

function Report({ o, onSaved }: { o: any; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(o.report ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = text !== (o.report ?? '');
  useEffect(() => setText(o.report ?? ''), [o.report]);
  const save = async () => {
    setSaving(true);
    try {
      await put(`/os/${o.id}/report`, { report: text });
      onSaved();
    } catch (e) {
      toast.err(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="O que foi feito" icon={ClipboardList} actions={o.can.work && dirty && <Button size="sm" onClick={save} loading={saving}>Salvar rascunho</Button>}>
      {o.can.work ? (
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && save()} placeholder="Descreva o serviço executado: diagnóstico, o que foi trocado/configurado, testes feitos, pendências…" />
      ) : o.report ? (
        <p className="text-sm whitespace-pre-wrap text-slate-700">{o.report}</p>
      ) : (
        <p className="text-sm text-slate-400">Nada lançado ainda.</p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- gastos

function Items({ o, onChanged }: { o: any; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: 'material', description: '', quantity: '1', unit_price: '' });
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const add = async () => {
    setBusy(true);
    try {
      await post(`/os/${o.id}/items`, { kind: f.kind, description: f.description, quantity: num(f.quantity) ?? 1, unit_price: num(f.unit_price) });
      setF({ kind: f.kind, description: '', quantity: '1', unit_price: '' });
      onChanged();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (i: any) => {
    try {
      await del(`/os/${o.id}/items/${i.id}`);
      onChanged();
    } catch (e) {
      toast.err(e);
    }
  };
  return (
    <Card title="Gastos (materiais e despesas)" icon={Receipt} bodyClass="">
      {o.items.length ? (
        <ul className="divide-y divide-slate-100">
          {o.items.map((i: any) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{i.description}</div>
                <div className="text-xs text-slate-500">
                  <Badge color={i.kind === 'despesa' ? 'purple' : 'slate'}>{i.kind === 'despesa' ? 'Despesa' : 'Material'}</Badge>
                  <span className="ml-2 tabular-nums">{i.quantity.toLocaleString('pt-BR')} × {fmtMoney(i.unit_price)}</span>
                  {i.created_by_name && <span className="ml-2">· {i.created_by_name}</span>}
                </div>
              </div>
              <div className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">{i.unit_price != null ? fmtMoney(i.quantity * i.unit_price) : '—'}</div>
              {o.can.work && <IconButton icon={Trash2} label="Remover" tone="danger" onClick={() => remove(i)} />}
            </li>
          ))}
          <li className="flex justify-between bg-slate-50/70 px-4 py-2.5 text-sm font-semibold sm:px-5"><span>Total</span><span className="tabular-nums">{fmtMoney(o.total_cost)}</span></li>
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-slate-400 sm:px-5">Nenhum gasto lançado.</p>
      )}
      {o.can.work && (
        <div className="grid grid-cols-6 gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
          <Select className="col-span-6 sm:col-span-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="material">Material</option>
            <option value="despesa">Despesa</option>
          </Select>
          <Input className="col-span-6 sm:col-span-2" placeholder={f.kind === 'despesa' ? 'Ex.: Estacionamento' : 'Ex.: Conector RJ45'} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Input className="col-span-2 sm:col-span-1" inputMode="decimal" placeholder="Qtd." value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <Input className="col-span-2 sm:col-span-1" inputMode="decimal" placeholder="R$ unit." value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })} />
          <Button className="col-span-2 sm:col-span-1" onClick={add} loading={busy} disabled={f.description.trim().length < 2}>Lançar</Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- fotos

function Photos({ o, onChanged, me }: { o: any; onChanged: () => void; me: number | undefined }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [open, setOpen] = useState<any>(null);
  const url = (p: any, thumb = false) => `/api/os/${o.id}/photos/${p.id}${thumb ? '?thumb=1' : ''}`;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    try {
      for (const [i, file] of list.entries()) {
        setProgress(`Enviando ${i + 1} de ${list.length}…`);
        await post(`/os/${o.id}/photos`, await preparePhoto(file));
      }
      toast.ok(list.length > 1 ? `${list.length} fotos enviadas.` : 'Foto enviada.');
    } catch (e) {
      toast.err(e);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
      onChanged();
    }
  };
  const remove = async (p: any) => {
    try {
      await del(`/os/${o.id}/photos/${p.id}`);
      setOpen(null);
      onChanged();
    } catch (e) {
      toast.err(e);
    }
  };

  return (
    <Card
      title={`Fotos (${o.photos.length})`}
      icon={Camera}
      actions={o.can.work && (
        <>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" onClick={() => input.current?.click()} loading={!!progress}><ImagePlus className="size-4" /> {progress ?? 'Adicionar fotos'}</Button>
        </>
      )}
    >
      {o.photos.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {o.photos.map((p: any) => (
            <button key={p.id} onClick={() => setOpen(p)} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
              <img src={url(p, true)} alt={p.caption ?? 'Foto do serviço'} loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
            </button>
          ))}
        </div>
      ) : (
        <Empty icon={Camera}>{o.can.work ? 'Registre o antes e o depois do serviço. No celular, “Adicionar fotos” abre a câmera.' : 'Nenhuma foto enviada.'}</Empty>
      )}
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={open?.caption || 'Foto do serviço'}
        description={open && `${open.uploaded_by_name ?? '—'} · ${fmtDateTime(open.created_at)}`}
        footer={open && (
          <>
            <a href={url(open)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Abrir original</a>
            {o.can.work && (o.can.deletePhotoOf === 'all' || open.uploaded_by === me) && <Button variant="danger" onClick={() => remove(open)}><Trash2 className="size-4" /> Remover</Button>}
          </>
        )}
      >
        {open && <img src={url(open)} alt={open.caption ?? 'Foto do serviço'} className="mx-auto max-h-[65dvh] rounded-xl object-contain" />}
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------- página

export default function ServiceOrderPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['os', Number(id)], queryFn: () => get(`/os/${id}`) });
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [report, setReport] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reopening, setReopening] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['os'] });
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.ok(ok);
      await refresh();
      return true;
    } catch (e) {
      toast.err(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorBox error={q.error} />;
  const o = q.data;
  const pr = OS_PRIORITY[o.priority]!;

  const onTimer = (a: 'start' | 'pause' | 'finish') => {
    if (a === 'finish') {
      setReport(o.report ?? '');
      setFinishing(true);
      return;
    }
    run(a, () => post(`/os/${o.id}/${a}`), a === 'start' ? 'Cronômetro iniciado.' : 'Serviço pausado.');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={<span className="flex items-center gap-1"><Link to="/os" className="hover:text-brand-700">Ordens de serviço</Link><ChevronRight className="size-3" />{osNumber(o.id)}</span>}
        title={o.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-700 tabular-nums">{osNumber(o.id)}</span>
            <OsStatusBadge status={o.status} />
            <Badge color={pr.color}>Prioridade {pr.label.toLowerCase()}</Badge>
          </span>
        }
        actions={o.can.manage && (
          <RowActions
            title={osNumber(o.id)}
            actions={[
              { icon: Pencil, label: 'Editar / atribuir', onClick: () => setEditing(true), show: o.can.edit },
              { icon: RotateCcw, label: 'Reabrir', onClick: () => setReopening(true), show: ['concluida', 'cancelada'].includes(o.status) },
              { icon: Ban, label: 'Cancelar ordem', tone: 'danger', onClick: () => { setReason(''); setCancelling(true); }, show: o.can.edit },
            ]}
          />
        )}
      />

      {o.status === 'cancelada' && <Notice kind="error">Ordem cancelada{o.cancel_reason ? `: ${o.cancel_reason}` : '.'}</Notice>}

      <Timer o={o} onAction={onTimer} busy={busy} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {o.description && (
            <Card title="Serviço solicitado" icon={ClipboardList}>
              <p className="text-sm whitespace-pre-wrap text-slate-700">{o.description}</p>
            </Card>
          )}
          <Report o={o} onSaved={refresh} />
          <Items o={o} onChanged={refresh} />
          <Photos o={o} onChanged={refresh} me={user?.id} />
        </div>

        <div className="space-y-5">
          <Card title="Dados da ordem">
            <dl className="space-y-3 text-sm">
              {[
                { icon: User, l: 'Técnico', v: o.assigned_name ?? <span className="text-amber-700">Sem técnico</span> },
                { icon: ClipboardList, l: 'Cliente', v: o.client_name ?? '—' },
                { icon: MapPin, l: 'Local', v: o.location },
                { icon: Phone, l: 'Contato', v: o.contact },
                { icon: Clock, l: 'Agendada para', v: o.scheduled_for && fmtDateTime(o.scheduled_for) },
                { icon: Receipt, l: 'Total de gastos', v: fmtMoney(o.total_cost) },
              ].filter((r) => r.v).map((r) => (
                <div key={r.l} className="flex gap-2.5">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <div className="min-w-0"><dt className="text-xs text-slate-500">{r.l}</dt><dd className="break-words text-slate-900">{r.v}</dd></div>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Aberta por {o.created_by_name ?? '—'} em {fmtDateTime(o.created_at)}</p>
          </Card>

          <Card title="Histórico" icon={History}>
            <ol className="relative space-y-3 border-l border-slate-200 pl-4">
              {o.events.map((e: any) => (
                <li key={e.id} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-white bg-slate-300 ring-1 ring-slate-200" />
                  <div className="text-sm font-medium text-slate-800">{EVENT[e.kind] ?? e.kind}</div>
                  {eventDetail(e) && <div className="text-xs break-words text-slate-600">{eventDetail(e)}</div>}
                  <div className="text-xs text-slate-400">{e.username ?? '—'} · {fmtDateTime(e.at)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={finishing}
        onClose={() => setFinishing(false)}
        title={`Finalizar ${osNumber(o.id)}`}
        description="O cronômetro para e a ordem fica como concluída."
        footer={
          <>
            <Button onClick={() => setFinishing(false)}>Voltar</Button>
            <Button
              variant="primary"
              disabled={report.trim().length < 5}
              loading={busy === 'finish'}
              onClick={async () => (await run('finish', () => post(`/os/${o.id}/finish`, { report }), 'Ordem de serviço concluída.')) && setFinishing(false)}
            >
              <CheckCircle2 className="size-4" /> Concluir ordem
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-xl border border-slate-200 py-2.5 text-center">
            <div><div className="font-semibold tabular-nums">{fmtClock(o.work_seconds + (o.running_since ? (Date.now() - new Date(o.running_since).getTime()) / 1000 : 0))}</div><div className="text-[11px] text-slate-500">Tempo</div></div>
            <div><div className="font-semibold tabular-nums">{fmtMoney(o.total_cost)}</div><div className="text-[11px] text-slate-500">Gastos</div></div>
            <div><div className="font-semibold tabular-nums">{o.photos.length}</div><div className="text-[11px] text-slate-500">Fotos</div></div>
          </div>
          <Field label="O que foi feito" hint="Obrigatório. Os gastos e as fotos já lançados ficam registrados na ordem.">
            <Textarea rows={6} value={report} onChange={(e) => setReport(e.target.value)} autoFocus />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={async () => (await run('cancel', () => post(`/os/${o.id}/cancel`, { reason }), 'Ordem cancelada.')) && setCancelling(false)}
        loading={busy === 'cancel'}
        title={`Cancelar ${osNumber(o.id)}`}
        confirmLabel="Cancelar ordem"
        message="A ordem sai da lista do técnico. Ela pode ser reaberta depois, se necessário."
      >
        <Field label="Motivo"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={reopening}
        onClose={() => setReopening(false)}
        onConfirm={async () => (await run('reopen', () => post(`/os/${o.id}/reopen`), 'Ordem reaberta.')) && setReopening(false)}
        loading={busy === 'reopen'}
        danger={false}
        title={`Reabrir ${osNumber(o.id)}`}
        confirmLabel="Reabrir"
        message="A ordem volta para o técnico responsável, que poderá retomar o cronômetro e lançar mais informações."
      />
      <ServiceOrderForm open={editing} onClose={() => setEditing(false)} initial={o} />
    </div>
  );
}
