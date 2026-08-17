/**
 * Shared scale helpers for the analytics charts.
 *
 * Kept out of the components because both the Comparables scatter and the Live
 * Sales dumbbell hit the same problem: auction prices want a log axis, but a
 * single bucket often spans well under one decade ($120k–$195k), where the
 * usual 1/2/5-per-decade ticks yield one label or none.
 */

/**
 * Log-scale ticks spanning [lo, hi].
 *
 * Prefers 1/2/5 decade ticks. When the range is too narrow to produce at least
 * three of them, steps evenly in log space instead and rounds to two significant
 * figures — which reads as "$120k, $150k, $190k" rather than the raw bounds.
 */
export function logTicks(lo, hi) {
  if (!(lo > 0) || !(hi > 0) || hi <= lo) return [];

  const nice = [];
  for (let mag = Math.floor(Math.log10(lo)); mag <= Math.ceil(Math.log10(hi)); mag++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** mag;
      if (v >= lo && v <= hi) nice.push(v);
    }
  }
  if (nice.length >= 3) return nice;

  const round2 = (v) => {
    const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
    return Math.round(v / mag) * mag;
  };
  const steps = 4;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const v = round2(Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / (steps - 1)));
    if (v >= lo && v <= hi && !out.includes(v)) out.push(v);
  }
  return out.length >= 2 ? out : [lo, hi];
}

/** USD, full precision — for tables and tooltips where the exact figure matters. */
export function usd(v) {
  return v == null ? '—' : `$${Math.round(Number(v)).toLocaleString('en-US')}`;
}

/** USD, abbreviated — for axis ticks and stat tiles, where width matters more. */
export function usdShort(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}
