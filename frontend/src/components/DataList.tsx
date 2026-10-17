import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Papel da coluna no card do celular:
 *  - title / subtitle: cabeçalho do card;
 *  - badges: linha de etiquetas logo abaixo;
 *  - field: par "rótulo: valor" na grade de detalhes;
 *  - full: bloco de largura total (ex.: comentário, detalhes);
 *  - actions: botões no canto do card;
 *  - hide: só aparece na tabela (computador).
 */
export type MobileRole = 'title' | 'subtitle' | 'badges' | 'field' | 'full' | 'actions' | 'hide';

export interface Col<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Classes da célula na tabela. */
  td?: string;
  mobile?: MobileRole;
  /** Rótulo no card (padrão: o cabeçalho, quando for texto). */
  label?: string;
}

interface Props<T> {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  /** Faixa colorida à esquerda do card (estado do item). */
  accent?: (row: T) => 'green' | 'red' | 'amber' | 'slate' | 'blue' | undefined;
}

const ACCENT = { green: 'before:bg-emerald-500', red: 'before:bg-red-500', amber: 'before:bg-amber-500', slate: 'before:bg-slate-300', blue: 'before:bg-brand-500' };
const stop = (e: React.MouseEvent) => e.stopPropagation();

/** Tabela no computador e cards no celular, a partir da mesma definição de colunas. */
export default function DataList<T>({ rows, cols, rowKey, onRowClick, rowClass, accent }: Props<T>) {
  const role = (c: Col<T>, i: number): MobileRole => c.mobile ?? (i === 0 ? 'title' : 'field');
  const pick = (r: MobileRole) => cols.filter((c, i) => role(c, i) === r);
  const title = pick('title');
  const subtitle = pick('subtitle');
  const badges = pick('badges');
  const fields = pick('field');
  const full = pick('full');
  const actions = pick('actions');

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="tbl">
          <thead>
            <tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} className={clsx(onRowClick && 'cursor-pointer', rowClass?.(r))} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {cols.map((c) => (
                  <td key={c.key} className={c.td} onClick={role(c, cols.indexOf(c)) === 'actions' ? stop : undefined}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((r, i) => {
          const a = accent?.(r);
          return (
            <li
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={clsx(
                'relative px-4 py-3.5',
                a && 'before:absolute before:top-3 before:bottom-3 before:left-0 before:w-[3px] before:rounded-r-full',
                a && ACCENT[a],
                onRowClick && 'cursor-pointer active:bg-slate-50',
                rowClass?.(r),
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {title.map((c) => <div key={c.key} className="text-[15px] font-semibold text-slate-900 [&_*]:break-words">{c.cell(r)}</div>)}
                  {subtitle.map((c) => <div key={c.key} className="mt-0.5 text-[13px] text-slate-500">{c.cell(r)}</div>)}
                </div>
                {actions.length > 0 && (
                  <div className="-mt-1 -mr-2 flex shrink-0 items-center" onClick={stop}>
                    {actions.map((c) => <div key={c.key} className="flex items-center">{c.cell(r)}</div>)}
                  </div>
                )}
                {onRowClick && !actions.length && <ChevronRight className="mt-0.5 size-5 shrink-0 text-slate-300" />}
              </div>
              {badges.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges.map((c) => <div key={c.key} className="contents">{c.cell(r)}</div>)}</div>
              )}
              {fields.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                  {fields.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{c.label ?? (typeof c.header === 'string' ? c.header : '')}</dt>
                      <dd className="mt-0.5 text-[13px] break-words text-slate-700">{c.cell(r)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {full.map((c) => (
                <div key={c.key} className="mt-2.5 text-[13px] text-slate-600">
                  {(c.label ?? (typeof c.header === 'string' ? c.header : '')) && (
                    <div className="mb-0.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{c.label ?? c.header}</div>
                  )}
                  {c.cell(r)}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </>
  );
}
