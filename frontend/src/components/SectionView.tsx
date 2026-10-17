import { useMemo, useState } from 'react';
import { columnsFor, type Col } from '../lib/columns';
import DataList from './DataList';
import { fmtBytes, isTrue } from '../lib/format';
import { Badge, Card, Empty, Notice, Pagination, SearchBox, usePaged } from './ui';

export interface Section {
  key: string;
  label: string;
  ok: boolean;
  rows?: Record<string, string>[];
  single?: boolean;
  reason?: string;
  kind?: string;
}

export function Cell({ col, value }: { col: Col; value: string | undefined }) {
  if (value === undefined || value === '') return <span className="text-slate-300">—</span>;
  switch (col.fmt) {
    case 'bool':
      return isTrue(value) ? <Badge color="green">sim</Badge> : <Badge>não</Badge>;
    case 'flag':
      return isTrue(value) ? <Badge color={col.key === 'disabled' ? 'red' : 'blue'}>sim</Badge> : <span className="text-slate-300">—</span>;
    case 'bytes':
      return <span className="whitespace-nowrap tabular-nums">{value.includes('/') ? value.split('/').map(fmtBytes).join(' / ') : fmtBytes(value)}</span>;
    case 'mono':
      return <span className="mono break-all">{value}</span>;
    default:
      return <span className="break-words">{value}</span>;
  }
}

export function KeyValue({ row }: { row: Record<string, string> }) {
  const entries = Object.entries(row).filter(([k]) => !k.startsWith('.'));
  if (!entries.length) return <Empty>Sem dados.</Empty>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1">
          <dt className="text-slate-500">{k}</dt>
          <dd className="break-all text-right font-medium">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabela de uma seção do RouterOS, com busca e paginação local. */
export function SectionTable({ module, section, pageSize = 25 }: { module: string; section: Section; pageSize?: number }) {
  const [search, setSearch] = useState('');
  const rows = section.rows ?? [];
  const cols = useMemo(() => columnsFor(module, section.key, rows), [module, section.key, rows]);
  const filtered = useMemo(() => {
    const t = search.toLowerCase();
    return t ? rows.filter((r) => Object.values(r).join(' ').toLowerCase().includes(t)) : rows;
  }, [rows, search]);
  const paged = usePaged(filtered, pageSize);

  if (!section.ok) {
    return (
      <Card title={section.label}>
        <Notice kind={section.kind === 'version' || section.kind === 'unsupported' ? 'info' : 'warning'}>Informação indisponível: {section.reason}</Notice>
      </Card>
    );
  }
  if (section.single) {
    return (
      <Card title={section.label}>
        <KeyValue row={rows[0] ?? {}} />
      </Card>
    );
  }
  return (
    <Card title={`${section.label} (${rows.length})`} bodyClass="" actions={rows.length > 8 && <SearchBox value={search} onChange={setSearch} className="w-full sm:w-56" />}>
      {filtered.length === 0 ? (
        <Empty>{rows.length ? 'Nada encontrado.' : 'Nenhum registro no equipamento.'}</Empty>
      ) : (
        <>
          <DataList
            rows={paged.slice}
            rowKey={(r, i) => r['.id'] ?? i}
            rowClass={(r) => (isTrue(r.disabled) ? 'text-slate-400' : undefined)}
            accent={(r) => (isTrue(r.disabled) ? 'slate' : r.running !== undefined ? (isTrue(r.running) ? 'green' : 'red') : undefined)}
            cols={cols.map((c, i) => ({
              key: c.key,
              header: c.label,
              cell: (r: Record<string, string>) => <Cell col={c} value={r[c.key]} />,
              // Celular: 1ª coluna como título, até 8 campos e o comentário em bloco.
              mobile: i === 0 ? 'title' : c.key === 'comment' ? 'full' : i > 8 ? 'hide' : 'field',
            }))}
          />
          <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
        </>
      )}
    </Card>
  );
}
