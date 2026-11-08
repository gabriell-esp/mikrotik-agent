import clsx from 'clsx';
import { useState } from 'react';

const SIZES = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-20 text-2xl', xl: 'size-28 text-3xl' };

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

/** Foto do usuário (URL versionada, fica em cache) ou as iniciais, quando não há foto. */
export default function Avatar({ id, name, version, size = 'sm', className, ring }: {
  id?: number | null; name?: string | null; version?: string | null; size?: keyof typeof SIZES; className?: string; ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const show = !!id && !!version && !failed;
  return (
    <span
      title={name ?? undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-600 to-slate-800 font-semibold text-white select-none',
        SIZES[size], ring && 'ring-2 ring-white', className,
      )}
    >
      {show ? (
        <img src={`/api/users/${id}/avatar?v=${encodeURIComponent(version!)}`} alt={name ?? ''} className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name ?? '')
      )}
    </span>
  );
}

/** Fotos sobrepostas da equipe da ordem (responsável + companheiro). */
export function Crew({ people, size = 'sm' }: { people: { id?: number | null; name?: string | null; version?: string | null }[]; size?: keyof typeof SIZES }) {
  const list = people.filter((p) => p.id);
  if (!list.length) return null;
  return (
    <span className="flex -space-x-2">
      {list.map((p) => <Avatar key={p.id} {...p} size={size} ring />)}
    </span>
  );
}
