import clsx from 'clsx';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './ui';

export interface RowAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'success' | 'warning';
  /** Texto mais curto para o menu do celular. */
  short?: string;
  show?: boolean;
}

const TONE_TEXT = { danger: 'text-red-600', success: 'text-emerald-700', warning: 'text-amber-700' };

/**
 * Ações de uma linha: ícones no computador; no celular, um botão "⋯" que abre
 * uma folha inferior com as opções em texto (alvos de toque grandes).
 */
export default function RowActions({ actions, title }: { actions: RowAction[]; title?: ReactNode }) {
  const list = actions.filter((a) => a.show !== false);
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const run = (a: RowAction) => {
    setOpen(false);
    a.onClick();
  };
  return (
    <>
      <div className="hidden items-center justify-end md:flex">
        {list.map((a) => <IconButton key={a.label} icon={a.icon} label={a.label} tone={a.tone} onClick={a.onClick} />)}
      </div>
      <div className="md:hidden">
        {list.length === 1 ? (
          <IconButton icon={list[0].icon} label={list[0].label} tone={list[0].tone} onClick={list[0].onClick} />
        ) : (
          <IconButton icon={MoreHorizontal} label="Ações" onClick={() => setOpen(true)} />
        )}
      </div>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[55] md:hidden" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" />
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden />
              {title && <div className="truncate px-5 pt-3 pb-1 text-sm font-semibold text-slate-900">{title}</div>}
              <div className="px-2 pt-1">
                {list.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => run(a)}
                    className={clsx('flex h-13 w-full items-center gap-3.5 rounded-xl px-3 text-left text-[15px] font-medium active:bg-slate-100', a.tone ? TONE_TEXT[a.tone] : 'text-slate-800')}
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-slate-100"><a.icon className="size-[18px]" /></span>
                    {a.short ?? a.label}
                  </button>
                ))}
              </div>
              <div className="px-3 pt-2">
                <button onClick={() => setOpen(false)} className="h-12 w-full rounded-xl bg-slate-100 text-[15px] font-medium text-slate-700 active:bg-slate-200">Cancelar</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
