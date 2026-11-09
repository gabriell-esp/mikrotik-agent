import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Ban, Camera, CheckCircle2, Package, Store, ChevronRight, ClipboardList, Clock, History, ImagePlus, MapPin, MessageCircle, Pause, Pencil, Phone, Play, Receipt, RotateCcw, Trash2,
  UserPlus, Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import RowActions from '../components/RowActions';
import ServiceOrderForm from '../components/ServiceOrderForm';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Field, IconButton, Input, Modal, Notice, PageHeader, PageSkeleton, Select, Textarea, useToast } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { fmtClock, fmtMoney, fmtPhone, OS_PRIORITY, osNumber, preparePhoto, useWorkSeconds, whatsappUrl } from '../lib/os';
import { OsStatusBadge } from './ServiceOrders';

const EVENT: Record<string, string> = {
  criada: 'Ordem aberta', editada: 'Dados alterados', atribuida: 'Técnico alterado', iniciada: 'Serviço iniciado', retomada: 'Serviço retomado',
  pausada: 'Serviço pausado', concluida: 'Ordem concluída', reaberta: 'Ordem reaberta', cancelada: 'Ordem cancelada',
  gasto: 'Item lançado', gasto_removido: 'Item removido', foto: 'Foto enviada', foto_removida: 'Foto removida',
  auxiliar: 'Companheiro alterado', finalizacao_confirmada: 'Finalização confirmada',
};

function eventDetail(e: any) {
  const d = e.details ?? {};
  if (e.kind === 'atribuida') return `${d.from ?? 'sem técnico'} → ${d.to ?? 'sem técnico'}`;
  if (e.kind === 'auxiliar') return `${d.from ?? 'nenhum'} → ${d.to ?? 'nenhum'}`;
  if (e.kind === 'criada' && d.assigned) return `para ${d.assigned}${d.helper ? ` e ${d.helper}` : ''}`;
  if (e.kind === 'cancelada') return d.reason;
  if (e.kind === 'gasto' || e.kind === 'gasto_removido') {
    if (d.kind === 'compra') return `Compra: ${d.description} (${d.store}) · ${fmtMoney(d.amount)}`;
    return d.quantity != null ? `${d.description} · ${fmtQty(d.quantity, d.unit ?? 'un')}` : d.description;
  }
  if (e.kind === 'foto') return d.caption;
  return null;
}

// ------------------------------------------------------------- cronômetro

/** Quem ainda precisa confirmar a finalização (ordens com dois técnicos). */
function pendingConfirm(o: any): { done: string[]; waiting: string[] } {
  if (!o.helper_id) return { done: [], waiting: [] };
  const done: string[] = [];
  const waiting: string[] = [];
  (o.assigned_done_at ? done : waiting).push(o.assigned_name ?? 'responsável');
  (o.helper_done_at ? done : waiting).push(o.helper_name ?? 'companheiro');
  return { done, waiting };
}

function Timer({ o, onAction, busy }: { o: any; onAction: (a: 'start' | 'pause' | 'finish') => void; busy: string | null }) {
  const sec = useWorkSeconds(o);
  const running = o.status === 'em_andamento';
  const closed = ['concluida', 'cancelada'].includes(o.status);
  const duo = !!o.helper_id;
  const { done, waiting } = pendingConfirm(o);
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
              o.can.confirmed ? (
                <Button className="h-11 px-5" disabled><CheckCircle2 className="size-4" /> Já finalizei</Button>
              ) : (
                <Button className="h-11 px-5" variant={running || done.length ? 'primary' : 'secondary'} onClick={() => onAction('finish')}>
                  <CheckCircle2 className="size-4" /> {duo && done.length ? 'Confirmar finalização' : 'Finalizar'}
                </Button>
              )
            )}
          </div>
        )}
      </div>
      {duo && !closed && done.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <Users className="mt-0.5 size-4 shrink-0" />
          <span><b>{done.join(' e ')}</b> já finalizou. Falta <b>{waiting.join(' e ')}</b> confirmar para a ordem ser concluída.</span>
        </div>
      )}
      {!o.can.execute && !closed && (
        <p className="mt-3 text-xs text-slate-500">
          {o.assigned_name
            ? <>Somente {duo ? <><b>{o.assigned_name}</b> e <b>{o.helper_name}</b> controlam</> : <><b>{o.assigned_name}</b> controla</>} o cronômetro desta ordem.</>
            : 'Atribua um técnico para que a ordem possa ser iniciada.'}
        </p>
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

// ------------------------------------------------------------- materiais e compras

const fmtQty = (q: number, unit: string) => `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit === 'm' ? 'm' : q === 1 ? 'unidade' : 'unidades'}`;

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col rounded-lg bg-slate-100 p-0.5">
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', value === k ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const EMPTY_ITEM = { kind: 'material' as 'material' | 'compra', description: '', quantity: '1', unit: 'un' as 'un' | 'm', store: '', amount: '' };

function Items({ o, onChanged }: { o: any; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY_ITEM });
  const [busy, setBusy] = useState(false);
  // Aceita "1,5", "1.5" e "1.234,50".
  const num = (v: string) => {
    const t = v.trim();
    if (!t) return NaN;
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  };
  const materials = o.items.filter((i: any) => i.kind === 'material');
  const purchases = o.items.filter((i: any) => i.kind === 'compra');
  const valid = f.kind === 'material'
    ? f.description.trim().length >= 2 && num(f.quantity) > 0
    : f.store.trim().length >= 2 && f.description.trim().length >= 2 && num(f.amount) > 0;

  const add = async () => {
    setBusy(true);
    try {
      await post(`/os/${o.id}/items`, f.kind === 'material'
        ? { kind: 'material', description: f.description, quantity: num(f.quantity), unit: f.unit }
        : { kind: 'compra', store: f.store, description: f.description, amount: num(f.amount) });
      // Mantém o tipo, a unidade e a loja para lançar vários itens seguidos.
      setF({ ...EMPTY_ITEM, kind: f.kind, unit: f.unit, store: f.store });
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
  const row = (i: any, main: React.ReactNode, sub: React.ReactNode, right: React.ReactNode) => (
    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium break-words text-slate-900">{main}</div>
        <div className="text-xs text-slate-500">{sub}{i.created_by_name && <> · {i.created_by_name}</>}</div>
      </div>
      <div className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">{right}</div>
      {o.can.work && <IconButton icon={Trash2} label="Remover" tone="danger" onClick={() => remove(i)} />}
    </li>
  );

  return (
    <Card title="Materiais e compras" icon={Package} bodyClass="">
      {!o.items.length && <p className="px-4 py-4 text-sm text-slate-400 sm:px-5">Nada lançado ainda.</p>}
      {materials.length > 0 && (
        <>
          <div className="bg-slate-50/70 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase sm:px-5">Materiais usados</div>
          <ul className="divide-y divide-slate-100">
            {materials.map((i: any) => row(i, i.description, 'Material', fmtQty(i.quantity, i.unit)))}
          </ul>
        </>
      )}
      {purchases.length > 0 && (
        <>
          <div className="bg-slate-50/70 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase sm:px-5">Compras em loja</div>
          <ul className="divide-y divide-slate-100">
            {purchases.map((i: any) => row(i, i.description, <span className="inline-flex items-center gap-1"><Store className="size-3" />{i.store}</span>, fmtMoney(i.amount)))}
            <li className="flex justify-between px-4 py-2.5 text-sm font-semibold sm:px-5"><span>Total pago em compras</span><span className="tabular-nums">{fmtMoney(o.total_cost)}</span></li>
          </ul>
        </>
      )}
      {o.can.work && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/40 px-4 py-3 sm:px-5">
          <Segmented value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[['material', 'Material usado'], ['compra', 'Compra em loja']]} />
          {f.kind === 'material' ? (
            <div className="grid grid-cols-6 gap-2">
              <Input className="col-span-6 sm:col-span-3" placeholder="Ex.: Cabo UTP cat6, conector RJ45" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              <Input className="col-span-2 sm:col-span-1" inputMode="decimal" placeholder="Qtd." value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
              <div className="col-span-4 sm:col-span-2">
                <Segmented value={f.unit} onChange={(unit) => setF({ ...f, unit })} options={[['un', 'Unidades'], ['m', 'Metros']]} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-2">
              <Input className="col-span-6 sm:col-span-2" placeholder="Loja" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} />
              <Input className="col-span-6 sm:col-span-3" placeholder="O que foi comprado" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              <Input className="col-span-6 sm:col-span-1" inputMode="decimal" placeholder="R$ pago" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{f.kind === 'compra' ? 'Tire uma foto da nota em “Fotos” para comprovar a compra.' : 'Somente a quantidade: valores dos materiais não são lançados aqui.'}</p>
            <Button onClick={add} loading={busy} disabled={!valid} className="shrink-0">Lançar</Button>
          </div>
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

// ------------------------------------------------------------- contatos

function Contacts({ o }: { o: any }) {
  const contacts: { name: string; phone: string }[] = o.contacts ?? [];
  const msg = `Olá! Sobre a ${osNumber(o.id)} (${o.title}).`;
  if (!contacts.length) {
    return <Notice>Esta ordem não tem contato cadastrado. {o.can.manage ? 'Edite a ordem e informe ao menos um contato com WhatsApp.' : 'Peça ao escritório para incluir.'}</Notice>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {contacts.map((c, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{c.name}</div>
            <a href={`tel:+${c.phone.length <= 11 ? `55${c.phone}` : c.phone}`} className="inline-flex items-center gap-1 text-xs text-slate-500 tabular-nums hover:text-brand-700">
              <Phone className="size-3" />{fmtPhone(c.phone)}
            </a>
          </div>
          <a
            href={whatsappUrl(c.phone, msg)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 active:scale-95"
          >
            <MessageCircle className="size-4" /> WhatsApp
          </a>
        </div>
      ))}
    </div>
  );
}

function CrewCard({ o, onHelper }: { o: any; onHelper: () => void }) {
  const people = [
    { id: o.assigned_to, name: o.assigned_name, version: o.assigned_avatar, role: 'Responsável', done: o.assigned_done_at },
    { id: o.helper_id, name: o.helper_name, version: o.helper_avatar, role: 'Companheiro', done: o.helper_done_at },
  ].filter((p) => p.id);
  return (
    <Card title="Equipe" icon={Users} actions={o.can.setHelper && (
      <Button size="sm" onClick={onHelper}><UserPlus className="size-4" /> {o.helper_id ? 'Trocar' : 'Companheiro'}</Button>
    )}>
      {people.length ? (
        <ul className="space-y-3">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <Avatar id={p.id} name={p.name} version={p.version} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500">{p.role}</div>
              </div>
              {o.helper_id && p.done && !['concluida', 'cancelada'].includes(o.status) && <Badge color="green" dot>Finalizou</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-amber-700">Sem técnico atribuído.</p>
      )}
    </Card>
  );
}

function HelperDialog({ o, open, onClose, onSaved }: { o: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const opts = useQuery({ queryKey: ['os', o.id, 'helper-options'], queryFn: () => get(`/os/${o.id}/helper-options`), enabled: open });
  const [sel, setSel] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(o.helper_id ? String(o.helper_id) : ''), [open, o.helper_id]);
  const save = async (helper: number | null) => {
    setBusy(true);
    try {
      await post(`/os/${o.id}/helper`, { helper_id: helper });
      toast.ok(helper ? 'Companheiro adicionado: ele já pode lançar na ordem.' : 'Companheiro removido.');
      onSaved();
      onClose();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Companheiro nesta ordem"
      description="Quem está ajudando também poderá lançar materiais, fotos e o relatório. Para concluir, os dois precisam finalizar."
      footer={
        <>
          {o.helper_id && <Button variant="ghost" className="sm:mr-auto" onClick={() => save(null)} disabled={busy}>Remover companheiro</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => save(Number(sel))} loading={busy} disabled={!sel || Number(sel) === o.helper_id}>Salvar</Button>
        </>
      }
    >
      <Field label="Técnico">
        <Select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Escolha…</option>
          {(opts.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.open ? ` · ${u.open} em aberto` : ''}</option>)}
        </Select>
      </Field>
    </Modal>
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
  const [helperOpen, setHelperOpen] = useState(false);

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

      <Contacts o={o} />

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
          <CrewCard o={o} onHelper={() => setHelperOpen(true)} />

          <Card title="Dados da ordem">
            <dl className="space-y-3 text-sm">
              {[
                { icon: ClipboardList, l: 'Cliente', v: o.client_name ?? '—' },
                { icon: MapPin, l: 'Local', v: o.location },
                { icon: Clock, l: 'Agendada para', v: o.scheduled_for && fmtDateTime(o.scheduled_for) },
                { icon: Receipt, l: 'Compras em loja', v: o.total_cost ? fmtMoney(o.total_cost) : null },
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
        description={
          !o.helper_id ? 'O cronômetro para e a ordem fica como concluída.'
            : pendingConfirm(o).done.length ? 'Sua confirmação conclui a ordem.'
              : `O cronômetro para e a ordem aguarda ${o.assigned_to === user?.id ? o.helper_name : o.assigned_name} também finalizar.`
        }
        footer={
          <>
            <Button onClick={() => setFinishing(false)}>Voltar</Button>
            <Button
              variant="primary"
              disabled={report.trim().length < 5}
              loading={busy === 'finish'}
              onClick={async () => {
                let result: any;
                const ok = await run('finish', async () => {
                  result = await post(`/os/${o.id}/finish`, { report });
                });
                if (!ok) return;
                toast.ok(result?.status === 'concluida' ? 'Ordem de serviço concluída.' : 'Sua finalização foi registrada. Falta o companheiro confirmar.');
                setFinishing(false);
              }}
            >
              <CheckCircle2 className="size-4" /> {o.helper_id && !pendingConfirm(o).done.length ? 'Finalizar minha parte' : 'Concluir ordem'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-xl border border-slate-200 py-2.5 text-center">
            <div><div className="font-semibold tabular-nums">{fmtClock(o.work_seconds + (o.running_since ? (Date.now() - new Date(o.running_since).getTime()) / 1000 : 0))}</div><div className="text-[11px] text-slate-500">Tempo</div></div>
            <div><div className="font-semibold tabular-nums">{fmtMoney(o.total_cost)}</div><div className="text-[11px] text-slate-500">Compras</div></div>
            <div><div className="font-semibold tabular-nums">{o.photos.length}</div><div className="text-[11px] text-slate-500">Fotos</div></div>
          </div>
          <Field label="O que foi feito" hint="Obrigatório. Os materiais, as compras e as fotos já lançados ficam registrados na ordem.">
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
      <HelperDialog o={o} open={helperOpen} onClose={() => setHelperOpen(false)} onSaved={refresh} />
    </div>
  );
}
