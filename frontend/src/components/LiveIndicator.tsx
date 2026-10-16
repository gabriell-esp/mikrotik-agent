import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import { fmtTime } from '../lib/format';
import { LIVE_INTERVAL_MS, useLive, useTick } from '../lib/live';

/**
 * Único elemento que muda a cada atualização automática: mostra o horário da última
 * sincronização e a contagem para a próxima. Clique para atualizar na hora.
 */
export default function LiveIndicator() {
  const { lastSync, nextAt, syncing, failed, refreshNow } = useLive();
  const now = useTick(1000);
  const remaining = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const progress = Math.min(100, ((LIVE_INTERVAL_MS - (nextAt - now)) / LIVE_INTERVAL_MS) * 100);

  return (
    <button
      onClick={() => void refreshNow()}
      title={failed ? 'Algumas informações não puderam ser atualizadas. Clique para tentar agora.' : `Atualização automática a cada 60 s — próxima em ${remaining} s. Clique para atualizar agora.`}
      className="group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-xs transition hover:border-slate-300"
    >
      <span className="relative flex size-2.5">
        {!failed && <span className={clsx('absolute inline-flex size-full rounded-full bg-emerald-400 opacity-60', syncing && 'animate-ping')} />}
        <span className={clsx('relative inline-flex size-2.5 rounded-full', failed ? 'bg-amber-500' : 'bg-emerald-500')} />
      </span>
      <span className="hidden sm:inline">Atualizado às</span>
      <span className="font-semibold tabular-nums text-slate-800">{fmtTime(lastSync)}</span>
      <span className="relative hidden h-1 w-10 overflow-hidden rounded-full bg-slate-100 md:block" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: `${syncing ? 100 : progress}%` }} />
      </span>
      <RefreshCw className={clsx('size-3.5 text-slate-400 group-hover:text-slate-600', syncing && 'animate-spin')} />
    </button>
  );
}
