import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowUpRight, Bell, Building2, CalendarDays, Check, FileText, Hourglass, ListChecks, ListTodo, Plus, Trash2, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ServiceOrderForm from '../components/ServiceOrderForm';
import { Badge, Button, ConfirmDialog, Empty, ErrorBox, Field, IconButton, Input, Modal, PageHeader, SearchBox, Select, TableSkeleton, Tabs, Textarea, useToast } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { fmtMoney, OS_PRIORITY, OS_STATUS, osNumber } from '../lib/os';

const KIND: Record<string, { label: string; plural: string; icon: LucideIcon; color: string }> = {
  os_futura: { label: 'Ordem futura', plural: 'Ordens futuras', icon: Wrench, color: 'bg-brand-50 text-brand-700 ring-brand-200' },
  orcamento: { label: 'Orçamento', plural: 'Orçamentos', icon: FileText, color: 'bg-violet-50 text-violet-700 ring-violet-200' },
  lembrete: { label: 'Lembrete', plural: 'Lembretes', icon: Bell, color: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

const STATUS_LABEL = (kind: string): Record<string, string> => ({
  pendente: 'Pendente',
  aguardando: kind === 'orcamento' ? 'Aguardando aprovação' : 'Aguardando terceiros',
  concluido: kind === 'orcamento' ? 'Aprovado / concluído' : 'Concluído',
  descartado: kind === 'orcamento' ? 'Recusado / descartado' : 'Descartado',
});

// ------------------------------------------------------------- datas (sempre no fuso do navegador)

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => localISO(new Date(Date.now() + n * 86400e3));
const dayDiff = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${localISO(new Date())}T12:00:00`).getTime()) / 86400e3);
const dateFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });

function dueLabel(iso: string | null, closed: boolean): { text: string; tone: string } | null {
  if (!iso) return null;
  const d = dayDiff(iso);
  const date = dateFmt.format(new Date(`${iso}T12:00:00`)).replace('.', '');
  if (closed) return { text: date, tone: 'text-slate-500' };
  if (d < 0) return { text: `Atrasado ${-d} dia${d === -1 ? '' : 's'} · ${date}`, tone: 'text-red-600 font-semibold' };
  if (d === 0) return { text: 'Hoje', tone: 'text-amber-700 font-semibold' };
  if (d === 1) return { text: 'Amanhã', tone: 'text-amber-700' };
  return { text: date, tone: 'text-slate-600' };
}

function groupOf(p: any): string {
  if (!p.due_date) return 'Sem prazo';
  const d = dayDiff(p.due_date);
  if (d < 0) return 'Atrasados';
  if (d === 0) return 'Hoje';
  if (d <= 7) return 'Próximos 7 dias';
  return 'Mais adiante';
}
const GROUPS = ['Atrasados', 'Hoje', 'Próximos 7 dias', 'Mais adiante', 'Sem prazo'];

const closedStatus = (s: string) => s === 'concluido' || s === 'descartado';

// ------------------------------------------------------------- formulário

const emptyItem = { kind: 'os_futura', title: '', notes: '', client_id: null as number | null, due_date: '', priority: 'normal', status: 'pendente', amount: '', checklist: [] as { text: string; done: boolean }[] };

function PlannerForm({ open, onClose, item, onToOs }: { open: boolean; onClose: () => void; item: any | null; onToOs: (p: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open });
  const [f, setF] = useState({ ...emptyItem });
  const [line, setLine] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const editing = !!item?.id;

  useEffect(() => {
    if (!open) return;
    setF(item?.id
      ? { ...emptyItem, ...item, notes: item.notes ?? '', due_date: item.due_date ?? '', amount: item.amount != null ? String(item.amount).replace('.', ',') : '' }
      : { ...emptyItem, ...item });
    setLine('');
    setError(null);
  }, [open, item]);

  const set = <K extends keyof typeof emptyItem>(k: K, v: (typeof emptyItem)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => {
    const t = f.amount.trim();
    const amount = t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : null;
    const checklist = line.trim() ? [...f.checklist, { text: line.trim(), done: false }] : f.checklist;
    return { kind: f.kind, title: f.title, notes: f.notes, client_id: f.client_id, due_date: f.due_date || null, priority: f.priority, status: f.status, amount: f.kind === 'orcamento' ? amount : null, checklist };
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const b = body();
      if (b.amount != null && Number.isNaN(b.amount)) throw new Error('Valor do orçamento inválido.');
      if (editing) await put(`/planner/${item.id}`, b);
      else await post('/planner', b);
      qc.invalidateQueries({ queryKey: ['planner'] });
      toast.ok(editing ? 'Item atualizado.' : 'Item adicionado ao planejamento.');
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await del(`/planner/${item.id}`);
      qc.invalidateQueries({ queryKey: ['planner'] });
      toast.ok('Item excluído.');
      setRemoving(false);
      onClose();
    } catch (e) {
      toast.err(e);
    }
  };

  const addLine = () => {
    if (!line.trim()) return;
    set('checklist', [...f.checklist, { text: line.trim(), done: false }]);
    setLine('');
  };
  const done = f.checklist.filter((c) => c.done).length;
  const labels = STATUS_LABEL(f.kind);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? KIND[f.kind]!.label : 'Novo item no planejamento'}
      description={editing && `Criado por ${item.created_by_name ?? '—'} em ${fmtDateTime(item.created_at)}${item.updated_by_name && item.updated_at !== item.created_at ? ` · alterado por ${item.updated_by_name} em ${fmtDateTime(item.updated_at)}` : ''}`}
      footer={
        <>
          {editing && <Button variant="ghost" className="sm:mr-auto" onClick={() => setRemoving(true)}><Trash2 className="size-4" /> Excluir</Button>}
          {editing && f.kind !== 'lembrete' && !item.service_order_id && (
            <Button onClick={() => onToOs({ ...item, ...body() })}><ArrowUpRight className="size-4" /> Gerar OS</Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={f.title.trim().length < 2}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(KIND).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => set('kind', k)}
              className={clsx('flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-medium transition', f.kind === k ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600' : 'border-slate-200 text-slate-600 hover:border-slate-300')}
            >
              <v.icon className="size-4 shrink-0" /> <span className="truncate">{v.label}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus={!editing} placeholder={f.kind === 'orcamento' ? 'Ex.: Orçamento CFTV da portaria' : f.kind === 'lembrete' ? 'Ex.: Renovar licença do servidor' : 'Ex.: Trocar nobreak do rack'} />
          </Field>
          <Field label="Cliente / condomínio">
            <Select value={f.client_id ?? ''} onChange={(e) => set('client_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— (sem cliente)</option>
              {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Prazo">
            <div className="flex gap-2">
              <Input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
              {f.due_date && <IconButton icon={X} label="Sem prazo" onClick={() => set('due_date', '')} />}
            </div>
          </Field>
          <Field label="Prioridade">
            <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              {Object.entries(OS_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Situação">
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {f.kind === 'orcamento' && (
            <Field label="Valor do orçamento (R$)">
              <Input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Ex.: 4.500,00" />
            </Field>
          )}
          <Field label="Anotações" className="sm:col-span-2">
            <Textarea rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Detalhes, contatos, materiais previstos, o que foi combinado…" />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-700">
            <span className="flex items-center gap-1.5"><ListChecks className="size-4 text-slate-400" /> Checklist</span>
            {f.checklist.length > 0 && <span className="text-xs text-slate-500 tabular-nums">{done}/{f.checklist.length}</span>}
          </div>
          <ul className="space-y-1">
            {f.checklist.map((c, i) => (
              <li key={i} className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={c.done}
                  onChange={() => set('checklist', f.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                  className="size-4 rounded border-slate-300 text-brand-600"
                />
                <span className={clsx('flex-1 text-sm', c.done && 'text-slate-400 line-through')}>{c.text}</span>
                <IconButton icon={X} label="Remover" onClick={() => set('checklist', f.checklist.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-2">
            <Input value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLine())} placeholder="Adicionar etapa e Enter" />
            <Button onClick={addLine} disabled={!line.trim()}><Plus className="size-4" /></Button>
          </div>
        </div>

        {editing && item.service_order_id && (
          <Link to={`/os/${item.service_order_id}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
            <span>Gerou a <b>{osNumber(item.service_order_id)}</b></span>
            {item.service_order_status && <Badge color={OS_STATUS[item.service_order_status]?.color} dot>{OS_STATUS[item.service_order_status]?.label}</Badge>}
          </Link>
        )}
      </div>
      <ConfirmDialog open={removing} onClose={() => setRemoving(false)} onConfirm={remove} title="Excluir item" confirmLabel="Excluir" message={<>Excluir <b>{item?.title}</b> do planejamento? O conteúdo fica guardado na auditoria.</>} />
    </Modal>
  );
}

// ------------------------------------------------------------- linha da lista

function Row({ p, onOpen, onStatus }: { p: any; onOpen: () => void; onStatus: (status: string) => void }) {
  const k = KIND[p.kind]!;
  const closed = closedStatus(p.status);
  const due = dueLabel(p.due_date, closed);
  const total = p.checklist.length;
  const done = p.checklist.filter((c: any) => c.done).length;
  return (
    <li className="group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
      <button
        onClick={() => onStatus(closed ? 'pendente' : 'concluido')}
        title={closed ? 'Reabrir' : 'Marcar como concluído'}
        className={clsx(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition',
          closed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500',
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1', k.color)}><k.icon className="size-3" />{k.label}</span>
          <span className={clsx('text-sm font-medium break-words', closed ? 'text-slate-400 line-through' : 'text-slate-900')}>{p.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {due && <span className={clsx('inline-flex items-center gap-1', due.tone)}><CalendarDays className="size-3.5" />{due.text}</span>}
          {p.client_name && <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{p.client_name}</span>}
          {['alta', 'urgente'].includes(p.priority) && !closed && <Badge color={OS_PRIORITY[p.priority]!.color}>{OS_PRIORITY[p.priority]!.label}</Badge>}
          {p.status === 'aguardando' && <span className="inline-flex items-center gap-1 text-violet-700"><Hourglass className="size-3.5" />{STATUS_LABEL(p.kind).aguardando}</span>}
          {p.status === 'descartado' && <span>{STATUS_LABEL(p.kind).descartado}</span>}
          {p.kind === 'orcamento' && p.amount != null && <span className="font-medium text-slate-700 tabular-nums">{fmtMoney(p.amount)}</span>}
          {total > 0 && <span className={clsx('inline-flex items-center gap-1 tabular-nums', done === total && 'text-emerald-700')}><ListChecks className="size-3.5" />{done}/{total}</span>}
          {p.service_order_id && <span className="inline-flex items-center gap-1 text-brand-700"><ArrowUpRight className="size-3.5" />{osNumber(p.service_order_id)}</span>}
        </div>
        {p.notes && <p className="mt-1 line-clamp-1 text-xs text-slate-400">{p.notes}</p>}
      </button>
    </li>
  );
}

// ------------------------------------------------------------- página

export default function PlannerPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [view, setView] = useState<'abertos' | 'encerrados'>('abertos');
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState({ kind: 'os_futura', title: '', due_date: '' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [toOs, setToOs] = useState<any>(null);

  const q = useQuery({
    queryKey: ['planner', view, kind, search],
    queryFn: () => get('/planner', { view, kind: kind || undefined, q: search || undefined }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = q.data?.rows ?? [];
  const counts = q.data?.counts ?? {};
  const groups = useMemo(() => {
    if (view !== 'abertos') return [['', rows]] as [string, any[]][];
    const m = new Map<string, any[]>();
    for (const r of rows) m.set(groupOf(r), [...(m.get(groupOf(r)) ?? []), r]);
    return GROUPS.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as [string, any[]]);
  }, [rows, view]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['planner'] });

  const quickAdd = async () => {
    if (quick.title.trim().length < 2) return;
    setAdding(true);
    try {
      await post('/planner', { kind: quick.kind, title: quick.title, due_date: quick.due_date || null });
      setQuick({ ...quick, title: '' });
      refresh();
    } catch (e) {
      toast.err(e);
    } finally {
      setAdding(false);
    }
  };
  const setStatus = async (p: any, status: string) => {
    try {
      await post(`/planner/${p.id}/status`, { status });
      if (status === 'concluido') toast.ok(`“${p.title}” concluído.`);
      refresh();
    } catch (e) {
      toast.err(e);
    }
  };
  const osPreset = useMemo(() => toOs && ({
    title: toOs.title,
    description: [toOs.notes, ...(toOs.checklist ?? []).filter((c: any) => !c.done).map((c: any) => `• ${c.text}`)].filter(Boolean).join('\n'),
    client_id: toOs.client_id,
    priority: toOs.priority,
  }), [toOs]);
  const openCount = (k: string) => counts[k]?.open ?? 0;
  const overdue = Object.values(counts).reduce((a: number, c: any) => a + (c.overdue ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planejamento"
        subtitle="Ordens a abrir, orçamentos e lembretes da equipe administrativa."
        actions={<Button variant="primary" className="w-full sm:w-auto" onClick={() => setEditing({})}><Plus className="size-4" /> Novo item</Button>}
      />

      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs sm:flex-row sm:items-center">
        <Select value={quick.kind} onChange={(e) => setQuick({ ...quick, kind: e.target.value })} className="sm:w-44">
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Input
          value={quick.title}
          onChange={(e) => setQuick({ ...quick, title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
          placeholder="Anotar rapidamente… (Enter para adicionar)"
          className="flex-1"
        />
        <div className="flex gap-2">
          <Input type="date" value={quick.due_date} onChange={(e) => setQuick({ ...quick, due_date: e.target.value })} className="flex-1 sm:w-40" title="Prazo (opcional)" />
          <Button onClick={quickAdd} loading={adding} disabled={quick.title.trim().length < 2}>Adicionar</Button>
        </div>
        <div className="flex gap-1.5 sm:hidden">
          {[['Hoje', 0], ['Amanhã', 1], ['+7 dias', 7]].map(([l, n]) => (
            <button key={l} onClick={() => setQuick({ ...quick, due_date: addDays(n as number) })} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600">{l}</button>
          ))}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: '', label: <>Tudo{overdue > 0 && view === 'abertos' && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{overdue} atrasado{overdue > 1 ? 's' : ''}</span>}</> },
          ...Object.entries(KIND).map(([k, v]) => ({ key: k, label: <>{v.plural}<span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{openCount(k)}</span></> })),
        ]}
        active={kind}
        onChange={setKind}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {([['abertos', 'Em aberto'], ['encerrados', 'Concluídos e descartados']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', view === k ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}>{l}</button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar título, anotação, cliente…" className="w-full sm:w-72" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        {q.isLoading ? <TableSkeleton cols={3} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !rows.length ? (
          <Empty icon={ListTodo}>{view === 'abertos' ? 'Nada pendente por aqui. Anote acima o que precisa ser feito.' : 'Nenhum item encerrado.'}</Empty>
        ) : (
          groups.map(([g, items]) => (
            <section key={g || 'all'}>
              {g && (
                <h3 className={clsx('flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] font-semibold tracking-wide uppercase sm:px-5', g === 'Atrasados' ? 'text-red-600' : 'text-slate-500')}>
                  {g}<span className="tabular-nums">{items.length}</span>
                </h3>
              )}
              <ul className="divide-y divide-slate-100">
                {items.map((p) => <Row key={p.id} p={p} onOpen={() => setEditing(p)} onStatus={(s) => setStatus(p, s)} />)}
              </ul>
            </section>
          ))
        )}
      </div>

      <PlannerForm open={!!editing} onClose={() => setEditing(null)} item={editing} onToOs={(p) => { setEditing(null); setToOs(p); }} />
      <ServiceOrderForm
        open={!!toOs}
        onClose={() => setToOs(null)}
        preset={osPreset ?? undefined}
        onSaved={async (o) => {
          try {
            await post(`/planner/${toOs.id}/link`, { service_order_id: o.id });
            toast.ok(`${osNumber(o.id)} aberta a partir do planejamento.`);
          } catch (e) {
            toast.err(e);
          }
          refresh();
        }}
      />
    </div>
  );
}
