import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Inbox, Info, Loader2, Search, X, XCircle, type LucideIcon } from 'lucide-react';
import {
  createContext, useCallback, useContext, useEffect, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { useTick } from '../lib/live';

// ---------------------------------------------------------------- botões e campos

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
type Size = 'sm' | 'md';

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        size === 'sm' ? 'h-9 px-3 text-xs sm:h-8 sm:px-2.5' : 'h-11 px-4 text-[15px] sm:h-9 sm:px-3.5 sm:text-sm',
        {
          primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700',
          secondary: 'border border-slate-200 bg-white text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50',
          danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
          ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
          subtle: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
        }[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Botão só com ícone, com dica acessível. */
export function IconButton({ icon: Icon, label, tone, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex size-10 items-center justify-center rounded-lg text-slate-400 sm:size-8 transition-colors hover:bg-slate-100 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        tone ? { danger: 'hover:bg-red-50 hover:text-red-600', success: 'hover:bg-emerald-50 hover:text-emerald-600', warning: 'hover:bg-amber-50 hover:text-amber-600' }[tone] : 'hover:text-slate-700',
        className,
      )}
    >
      <Icon className="size-[18px] sm:size-4" />
    </button>
  );
}

const inputCls =
  'h-11 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-800 sm:h-9 sm:text-sm shadow-xs placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-slate-500';

/** Largura total por padrão, a menos que o chamador defina uma classe w-*. */
const widthCls = (cls?: string) => clsx(inputCls, !/(^|\s)w-/.test(cls ?? '') && 'w-full', cls);

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={widthCls(p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(widthCls(p.className), 'h-auto py-2')} />;
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={clsx(widthCls(p.className), 'pr-8')}>
    {children}
  </select>
);

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5 text-sm text-slate-700', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-brand-600 sm:size-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={clsx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- superfícies

export function Card({ title, subtitle, actions, children, className, bodyClass, icon: Icon }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; icon?: LucideIcon;
}) {
  return (
    <section className={clsx('overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs sm:rounded-xl', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && <Icon className="size-4 shrink-0 text-slate-400" />}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-800">{title}</h2>
              {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
        </header>
      )}
      <div className={clsx(bodyClass ?? 'p-4 sm:p-5')}>{children}</div>
    </section>
  );
}

type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
const TONE: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  blue: 'bg-brand-50 text-brand-700',
  purple: 'bg-violet-50 text-violet-700',
};
const DOT: Record<Tone, string> = { slate: 'bg-slate-400', green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-brand-500', purple: 'bg-violet-500' };

export function Badge({ color = 'slate', children, title, dot }: { color?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', TONE[color])}>
      {dot && <span className={clsx('size-1.5 rounded-full', DOT[color])} />}
      {children}
    </span>
  );
}

const DEVICE_STATUS: Record<string, { label: string; color: Tone }> = {
  online: { label: 'Gerenciável', color: 'green' },
  unreachable: { label: 'Inacessível', color: 'red' },
  auth_failed: { label: 'Falha de autenticação', color: 'amber' },
  error: { label: 'Erro de comunicação', color: 'amber' },
  unknown: { label: 'Não verificado', color: 'slate' },
};

/** Estado de gerência (API/REST) — independente do túnel WireGuard. */
export function DeviceStatusBadge({ status, title }: { status: string; title?: string | null }) {
  const s = DEVICE_STATUS[status] ?? DEVICE_STATUS.unknown;
  return <Badge color={s.color} title={title ?? undefined} dot>{s.label}</Badge>;
}
export const deviceStatusLabel = (s: string) => (DEVICE_STATUS[s] ?? DEVICE_STATUS.unknown).label;

const PEER_STATE: Record<string, { label: string; color: Tone; hint: string }> = {
  recent: { label: 'Handshake recente', color: 'green', hint: 'Túnel com handshake dentro do limite configurado.' },
  stale: { label: 'Sem handshake recente', color: 'amber', hint: 'Pode ser apenas ausência de tráfego (sem keepalive). Não indica, por si só, equipamento fora do ar.' },
  never: { label: 'Sem handshake', color: 'slate', hint: 'A central não registrou handshake com este peer desde que foi iniciada.' },
  disabled: { label: 'Peer desabilitado', color: 'red', hint: 'Peer desabilitado na central.' },
};

/** Estado do túnel WireGuard visto pela central. */
export function PeerStateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-xs text-slate-400">sem peer vinculado</span>;
  const s = PEER_STATE[state] ?? PEER_STATE.never;
  return <Badge color={s.color} title={s.hint} dot>{s.label}</Badge>;
}
export const peerStateLabel = (s: string) => PEER_STATE[s]?.label ?? s;

// ---------------------------------------------------------------- estados

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin text-brand-600" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

/** Placeholder de tabela usado só no primeiro carregamento. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 px-5 py-3.5">
          {Array.from({ length: cols }, (_, j) => <Skeleton key={j} className={clsx('h-4', j === 0 ? 'w-1/4' : 'flex-1')} />)}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function Empty({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-slate-500">
      <div className="flex size-10 items-center justify-center rounded-full bg-slate-100"><Icon className="size-5 text-slate-400" /></div>
      {children}
    </div>
  );
}

export function ErrorBox({ error, title = 'Não foi possível carregar' }: { error: unknown; title?: string }) {
  if (!error) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50/70 p-3.5 text-sm text-red-800">
      <XCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">
        <div className="font-medium">{title}</div>
        <div className="text-red-700">{(error as Error).message}</div>
      </div>
    </div>
  );
}

export function Notice({ kind = 'warning', children }: { kind?: 'warning' | 'info' | 'error'; children: ReactNode }) {
  const Icon = kind === 'info' ? Info : AlertTriangle;
  return (
    <div className={clsx('flex gap-3 rounded-lg border p-3.5 text-sm', {
      warning: 'border-amber-200 bg-amber-50/70 text-amber-900',
      info: 'border-brand-100 bg-brand-50/60 text-brand-900',
      error: 'border-red-200 bg-red-50/70 text-red-800',
    }[kind])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "há 3 min" que se atualiza sozinho, sem re-renderizar a página. */
export function TimeAgo({ date, never = 'nunca', className }: { date: string | Date | null | undefined; never?: string; className?: string }) {
  useTick(15_000);
  return (
    <span className={className} title={date ? fmtDateTime(date) : undefined}>
      {date ? fmtAgo(date) : never}
    </span>
  );
}

/** Data/hora da coleta e aviso de dados desatualizados. */
export function Freshness({ collectedAt, stale, error }: { collectedAt: string | null; stale?: boolean; error?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <Clock className="size-3.5" />
      {collectedAt ? (
        <span>
          Coletado em {fmtDateTime(collectedAt)} (<TimeAgo date={collectedAt} />)
        </span>
      ) : (
        <span>Nenhuma coleta concluída ainda</span>
      )}
      {stale && <Badge color="amber">Desatualizado</Badge>}
      {error && <span className="text-amber-700" title={error}>Última tentativa falhou: {error.length > 140 ? error.slice(0, 140) + '…' : error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- indicadores

export function StatCard({ label, value, icon: Icon, tone = 'blue', hint, foot }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: Tone; hint?: string; foot?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs sm:rounded-xl sm:p-5" title={hint}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs leading-snug font-medium text-slate-500 sm:text-[13px]">{label}</div>
        <div className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9', TONE[tone])}><Icon className="size-4 sm:size-[18px]" /></div>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-3xl">{value}</div>
      {foot && <div className="mt-1 line-clamp-2 text-[11px] text-slate-500 sm:text-xs">{foot}</div>}
    </div>
  );
}

/** Barra segmentada com legenda (ex.: distribuição de status). */
export function SegmentBar({ segments }: { segments: { label: string; value: number; tone: Tone }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className={clsx(DOT[s.tone], 'transition-[width] duration-500')} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-2 text-slate-600"><span className={clsx('size-2 rounded-full', DOT[s.tone])} />{s.label}</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- tabelas e navegação

export function SearchBox({ value, onChange, placeholder = 'Buscar…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex flex-row-reverse items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:flex-row sm:px-5 sm:py-2.5">
      <span className="hidden sm:inline">
        Mostrando <b className="font-medium text-slate-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</b> de <b className="font-medium text-slate-700">{total}</b>
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)} />
          <span className="px-1 tabular-nums">{page} / {pages}</span>
          <IconButton icon={ChevronRight} label="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)} />
        </div>
      )}
      <span className="sm:hidden">{total} itens</span>
    </div>
  );
}

/** Paginação local para listas já carregadas. */
export function usePaged<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(1);
  }, [page, pages]);
  return { page, setPage, pageSize, total: rows.length, slice: rows.slice((page - 1) * pageSize, page * pageSize) };
}

export function Modal({ open, onClose, title, description, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx('flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-slate-900/5 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <header className="flex items-start justify-between gap-4 px-5 pt-3 pb-3 sm:px-6 sm:pt-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <IconButton icon={X} label="Fechar" onClick={onClose} className="-mr-2" />
        </header>
        <div className="overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:px-6 sm:py-3.5 [&>button]:flex-1 sm:[&>button]:flex-none">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmação para operações destrutivas; opcionalmente exige digitar um texto. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmText, confirmLabel = 'Confirmar', loading, danger = true, children,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmText?: string;
  confirmLabel?: string; loading?: boolean; danger?: boolean; children?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [open]);
  const ok = !confirmText || typed === confirmText;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600">
        <div>{message}</div>
        {children}
        {confirmText && (
          <Field label={`Para confirmar, digite: ${confirmText}`}>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:py-2.5',
            active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 text-xs font-medium text-slate-500">{breadcrumb}</div>}
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- notificações (toasts)

type Toast = { id: number; kind: 'success' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px] lg:bottom-4">
        {items.map((t) => (
          <div key={t.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 shadow-lg">
            {t.kind === 'error' ? <XCircle className="size-5 shrink-0 text-red-500" /> : <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />}
            <span className="pt-px">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return { ok: (t: string) => push('success', t), err: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)) };
}
