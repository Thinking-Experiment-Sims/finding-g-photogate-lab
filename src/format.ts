/** Format a number for display. Anything non-finite becomes an em dash — the UI never shows NaN or Infinity. */
export function fmt(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Object.is(value, -0) || Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits).replace('-', '−');
}

/** Signed version: always shows + or −. */
export function fmtSigned(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const s = fmt(value, digits);
  return s.startsWith('−') || /^0\.?0*$/.test(s) ? s : `+${s}`;
}

/** Pick ~count "nice" tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

export function tickLabel(v: number, span: number): string {
  const digits = span >= 5 ? 0 : span >= 0.5 ? 1 : span >= 0.05 ? 2 : 3;
  return fmt(v, digits).replace(/^−?0\.?0*$/, '0');
}
