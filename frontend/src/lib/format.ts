const dtf = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const tf = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : dtf.format(d);
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return tf.format(new Date(v));
}

export function fmtAgo(v: string | Date | null | undefined): string {
  if (!v) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  return 'há ' + fmtDuration(s);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

export function fmtBytes(v: number | string | null | undefined): string {
  const n = Number(v);
  if (v == null || v === '' || !isFinite(n)) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

export function fmtBps(v: number | null | undefined): string {
  if (v == null) return '—';
  const u = ['bps', 'kbps', 'Mbps', 'Gbps'];
  let i = 0;
  let x = v;
  while (x >= 1000 && i < u.length - 1) {
    x /= 1000;
    i++;
  }
  return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${u[i]}`;
}

export function pct(free: string | number | undefined, total: string | number | undefined): number | null {
  const f = Number(free);
  const t = Number(total);
  if (!t || !isFinite(f)) return null;
  return Math.round(100 - (f / t) * 100);
}

export const isTrue = (v: unknown) => v === true || v === 'true' || v === 'yes';
