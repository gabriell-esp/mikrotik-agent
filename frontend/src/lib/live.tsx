import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** Intervalo da atualização automática (alinhado à coleta do backend). */
export const LIVE_INTERVAL_MS = 60_000;

interface LiveState {
  lastSync: Date;
  nextAt: number;
  syncing: boolean;
  failed: boolean;
  refreshNow: () => Promise<void>;
}

const Ctx = createContext<LiveState | null>(null);

/**
 * Relógio único de atualização: a cada 60 s recarrega, em segundo plano, apenas as consultas
 * visíveis na tela. Os dados são trocados sem estado de carregamento — só o indicador muda.
 * Consultas com `meta: { live: false }` ficam de fora. Pausa com a aba oculta.
 */
export function LiveRefreshProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState(() => new Date());
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nextAt, setNextAt] = useState(() => Date.now() + LIVE_INTERVAL_MS);
  const running = useRef(false);
  const nextRef = useRef(nextAt);

  const refreshNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      const live = (q: { meta?: Record<string, unknown>; state: { status: string } }) => q.meta?.live !== false && q.state.status !== 'pending';
      await qc.refetchQueries({ type: 'active', predicate: live }, { throwOnError: false, cancelRefetch: false });
      setFailed(qc.getQueryCache().findAll({ type: 'active', predicate: live }).some((q) => q.state.status === 'error'));
      setLastSync(new Date());
    } finally {
      nextRef.current = Date.now() + LIVE_INTERVAL_MS;
      setNextAt(nextRef.current);
      running.current = false;
      setSyncing(false);
    }
  }, [qc]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (!document.hidden && Date.now() >= nextRef.current) void refreshNow();
    }, 1000);
    const onVisible = () => {
      if (!document.hidden && Date.now() >= nextRef.current) void refreshNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshNow]);

  return <Ctx.Provider value={{ lastSync, nextAt, syncing, failed, refreshNow }}>{children}</Ctx.Provider>;
}

export function useLive(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error('LiveRefreshProvider ausente');
  return v;
}

/** Re-renderiza apenas o componente que chamar, no intervalo indicado. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
