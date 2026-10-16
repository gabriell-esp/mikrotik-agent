import type { RosRecord } from '../routeros/types.js';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Data do relógio do roteador em YYYY-MM-DD ("jan/02/2024" no v6, "2024-01-02" no v7.10+). */
export function clockDate(clock: RosRecord | undefined): string | null {
  const d = clock?.date;
  if (!d) return null;
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = d.match(/^([a-z]{3})\/(\d{2})\/(\d{4})$/i);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2]}`;
  return null;
}

/**
 * Normaliza o horário de uma linha de log para "YYYY-MM-DD HH:MM:SS" (hora local do roteador).
 * Formatos: "10:11:12" (hoje), "jan/02 10:11:12", "jan/02/2023 10:11:12", "2024-01-02 10:11:12", "01-02 10:11:12".
 */
export function normalizeLogTime(time: string | undefined, today: string | null): string | null {
  if (!time) return null;
  const t = time.trim();
  let m = t.match(/^(\d{2}:\d{2}:\d{2})$/);
  if (m) return today ? `${today} ${m[1]}` : null;
  m = t.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (m) return `${m[1]} ${m[2]}`;
  m = t.match(/^(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (m && today) return `${guessYear(today, m[1])}-${m[1]}-${m[2]} ${m[3]}`;
  m = t.match(/^([a-z]{3})\/(\d{2})(?:\/(\d{4}))? (\d{2}:\d{2}:\d{2})$/i);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (!mon) return null;
    const year = m[3] ?? (today ? guessYear(today, mon) : null);
    return year ? `${year}-${mon}-${m[2]} ${m[4]}` : null;
  }
  return null;
}

/** Sem ano explícito, um mês posterior ao atual pertence ao ano anterior. */
function guessYear(today: string, month: string): string {
  const [y, mo] = today.split('-');
  return Number(month) > Number(mo) ? String(Number(y) - 1) : y;
}

export interface LogFilter {
  topic?: string;
  q?: string;
  from?: string;
  to?: string;
}

export function filterLogs(rows: RosRecord[], clock: RosRecord | undefined, f: LogFilter) {
  const today = clockDate(clock);
  const topic = f.topic?.toLowerCase();
  const q = f.q?.toLowerCase();
  const from = f.from?.replace('T', ' ');
  const to = f.to?.replace('T', ' ');
  const out = [];
  const topics = new Set<string>();
  for (const r of rows) {
    const rowTopics = (r.topics ?? '').split(',').filter(Boolean);
    rowTopics.forEach((t) => topics.add(t));
    const ts = normalizeLogTime(r.time, today);
    if (topic && !rowTopics.some((t) => t.toLowerCase() === topic)) continue;
    if (q && !(r.message ?? '').toLowerCase().includes(q)) continue;
    if ((from || to) && !ts) continue;
    if (from && ts! < from) continue;
    if (to && ts! > to) continue;
    out.push({ id: r['.id'], time: r.time, ts, topics: rowTopics, message: r.message ?? '' });
  }
  return { rows: out.reverse(), topics: [...topics].sort(), routerDate: today, gmtOffset: clock?.['gmt-offset'] ?? null };
}
