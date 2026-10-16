/**
 * Converte durações do RouterOS em segundos. Aceita os formatos do v7 ("1w2d3h4m5s", "450ms")
 * e do v6 ("1w2d03:04:05", "00:01:02").
 */
export function parseDuration(value: string | undefined | null): number | null {
  if (value == null || value === '') return null;
  let s = value.trim();
  let total = 0;
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  // Parte hh:mm:ss final (v6)
  const clock = s.match(/(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    s = s.slice(0, clock.index);
  }
  const re = /(\d+(?:\.\d+)?)(ms|us|ns|w|d|h|m|s)/g;
  let matched = !!clock;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const n = Number(m[1]);
    if (m[2] in units) total += n * units[m[2]];
    else if (m[2] === 'ms') total += n / 1000;
  }
  if (!matched) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return Math.floor(total);
}

export function toInt(v: string | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toBool(v: string | undefined | null): boolean {
  return v === 'true' || v === 'yes';
}

/** "7.15.3 (stable)" -> [7, 15, 3] */
export function parseVersion(v: string | null | undefined): number[] {
  const m = (v ?? '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0];
}

export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  const a = parseVersion(v);
  const b = parseVersion(min);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
