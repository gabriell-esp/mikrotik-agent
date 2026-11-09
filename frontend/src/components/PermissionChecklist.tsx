import type { ReactNode } from 'react';
import { Checkbox } from './ui';

/** Seções da lista de permissões (pelo prefixo da chave). */
const SECTIONS: { label: string; prefixes: string[] }[] = [
  { label: 'Geral', prefixes: ['dashboard'] },
  { label: 'Clientes e equipamentos', prefixes: ['clients', 'devices', 'wireguard'] },
  { label: 'Monitoramento', prefixes: ['monitor', 'logs'] },
  { label: 'PPPoE', prefixes: ['pppoe'] },
  { label: 'UniFi', prefixes: ['unifi'] },
  { label: 'Ordens de serviço', prefixes: ['os', 'planner'] },
  { label: 'Administração', prefixes: ['users', 'audit', 'notifications'] },
];

export function groupCatalog(catalog: Record<string, string>) {
  const used = new Set<string>();
  const out = SECTIONS.map((s) => {
    const items = Object.entries(catalog).filter(([k]) => s.prefixes.includes(k.split('.')[0]!));
    items.forEach(([k]) => used.add(k));
    return { label: s.label, items };
  });
  const rest = Object.entries(catalog).filter(([k]) => !used.has(k));
  if (rest.length) out.push({ label: 'Outras', items: rest });
  return out.filter((s) => s.items.length);
}

/** Lista de permissões em seções, com marcação e etiqueta opcional por item. */
export default function PermissionChecklist({ catalog, checked, onToggle, badge, disabled }: {
  catalog: Record<string, string>;
  checked: (p: string) => boolean;
  onToggle: (p: string, on: boolean) => void;
  badge?: (p: string) => ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {groupCatalog(catalog).map((s) => {
        const on = s.items.filter(([p]) => checked(p)).length;
        return (
          <div key={s.label} className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
              <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{s.label}</span>
              {!disabled && (
                <button
                  type="button"
                  className="text-xs font-medium text-brand-700 hover:text-brand-800"
                  onClick={() => s.items.forEach(([p]) => checked(p) !== (on < s.items.length) && onToggle(p, on < s.items.length))}
                >
                  {on < s.items.length ? 'Marcar todas' : 'Desmarcar todas'}
                </button>
              )}
            </div>
            <div className="grid gap-1.5 p-2.5 sm:grid-cols-2">
              {s.items.map(([p, label]) => (
                <Checkbox key={p} checked={checked(p)} disabled={disabled} onChange={(v) => onToggle(p, v)} label={<span>{label} {badge?.(p)}</span>} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
