'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/adminApi';
import { usdShort } from '../lib/chartScales';

/**
 * Market Pulse — which way is the market moving?
 *
 * The index is mix-adjusted (within-bucket fixed effects on log price), because
 * average and median sale price both move when the MIX of cars consigned
 * changes, which it does every quarter. See supabase_migration_market_pulse.sql
 * for the estimator and its measured accuracy.
 *
 * Price and sell-through are stacked on a SHARED X-AXIS rather than sharing one
 * plot with two y-scales. A dual-axis chart's alignment is arbitrary, so it
 * invents a correlation; two charts one above the other show the same lead-lag
 * without the artefact.
 */

/* Validated on slate-800, all-pairs CVD ΔE 10.2. Colour follows the tier, so
   filtering never repaints a surviving series. */
const TIER_COLORS = {
  '1 · under $25k': '#3d8ede',
  '2 · $25k–$50k': '#b8861b',
  '3 · $50k–$100k': '#22a37c',
  '4 · $100k–$250k': '#94a3b8',
  '5 · $250k and up': '#ef3a32',
};
const ALL = 'All tiers';
const GRID = '#334155';
const AXIS = '#64748b';

const shortPeriod = (p) => (p ? `${String(p).slice(2, 4)} Q${Math.floor(Number(String(p).slice(5, 7)) / 3) + 1}` : '—');

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none fixed z-50 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs shadow-xl"
         style={{ left: tip.x + 14, top: tip.y + 14 }}>
      <div className="font-semibold text-white">{tip.title}</div>
      {tip.sub && <div className="mt-0.5 text-slate-400">{tip.sub}</div>}
      {tip.rows.map((r) => (
        <div key={r.label} className="mt-1 flex items-center gap-2">
          {r.color && <span className="h-0.5 w-3 rounded" style={{ background: r.color }} />}
          <span className="text-slate-400">{r.label}</span>
          <span className="ml-auto font-mono text-white">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Multi-line chart with a crosshair. `periods` is the shared x domain so the
 * two charts on this tab line up column for column.
 */
function LineChart({ series, periods, height, yFmt, valueFmt, refY, onTip, label }) {
  const [ref, w] = useWidth();
  const live = series.filter((s) => s.values.some((v) => v != null));
  if (periods.length < 2 || live.length === 0) {
    return <div ref={ref} className="flex h-[180px] items-center justify-center text-sm text-slate-500">Needs at least two quarters of data.</div>;
  }

  const m = { t: 16, r: 58, b: 30, l: 50 };
  const iw = Math.max(w - m.l - m.r, 10);
  const ih = height - m.t - m.b;
  const all = live.flatMap((s) => s.values.filter((v) => v != null).map(Number));
  const lo = Math.min(...all, refY ?? Infinity);
  const hi = Math.max(...all, refY ?? -Infinity);
  const padLo = lo - (hi - lo) * 0.12 - 0.5;
  const padHi = hi + (hi - lo) * 0.12 + 0.5;
  const sx = (i) => (i / (periods.length - 1)) * iw;
  const sy = (v) => ih - ((v - padLo) / (padHi - padLo)) * ih;

  const ticks = [];
  const span = padHi - padLo;
  const step = span > 60 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 2;
  for (let t = Math.ceil(padLo / step) * step; t <= padHi; t += step) ticks.push(t);

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${height}`} height={height} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} y1={sy(t)} x2={iw} y2={sy(t)} stroke={GRID} strokeWidth={1} />
                <text x={-10} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">{yFmt(t)}</text>
              </g>
            ))}
            {refY != null && <line x1={0} y1={sy(refY)} x2={iw} y2={sy(refY)} stroke="#94a3b8" strokeWidth={1} />}
            {periods.map((p, i) => (
              <text key={p} x={sx(i)} y={ih + 18} textAnchor="middle" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">
                {shortPeriod(p)}
              </text>
            ))}

            {live.map((s) => {
              // Split into runs of consecutive non-null points. Filtering the
              // nulls out instead would draw a straight line straight across a
              // quarter with no data, which reads as continuity that isn't there.
              const runs = [];
              let run = [];
              s.values.forEach((v, i) => {
                if (v == null) { if (run.length) runs.push(run); run = []; return; }
                run.push({ x: sx(i), y: sy(Number(v)) });
              });
              if (run.length) runs.push(run);
              if (runs.length === 0) return null;

              const lastRun = runs[runs.length - 1];
              const last = lastRun[lastRun.length - 1];
              const lastVal = [...s.values].reverse().find((v) => v != null);
              return (
                <g key={s.name}>
                  {runs.map((pts, ri) => (
                    pts.length === 1
                      // A lone point between two gaps still has to be visible.
                      ? <circle key={ri} cx={pts[0].x} cy={pts[0].y} r={3} fill={s.color} />
                      : <path key={ri}
                              d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
                              fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.5 : 2}
                              strokeLinecap="round" strokeLinejoin="round" strokeOpacity={s.emphasis ? 1 : 0.85} />
                  ))}
                  <circle cx={last.x} cy={last.y} r={4} fill={s.color} stroke="#1e293b" strokeWidth={2} />
                  <text x={last.x + 8} y={last.y + 4} fontSize={11} fontWeight={600} fill="#cbd5e1" fontFamily="ui-monospace, monospace">
                    {valueFmt(lastVal)}
                  </text>
                </g>
              );
            })}

            {periods.map((p, i) => (
              <rect key={p} x={sx(i) - iw / (periods.length * 2)} y={0} width={iw / periods.length} height={ih}
                    fill="transparent" style={{ cursor: 'crosshair' }}
                    onPointerEnter={(e) => onTip({
                      x: e.clientX, y: e.clientY, title: shortPeriod(p), sub: label,
                      rows: live.filter((s) => s.values[i] != null).map((s) => ({
                        color: s.color, label: s.name, value: valueFmt(s.values[i]),
                      })),
                    })}
                    onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                    onPointerLeave={() => onTip(null)} />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

function Stat({ label, value, sub, dir }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className={`mt-1 text-xs ${dir === 'up' ? 'text-emerald-400' : dir === 'down' ? 'text-red-400' : 'text-slate-500'}`}>{sub}</div>}
    </div>
  );
}

export default function MarketPulse() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [byTier, setByTier] = useState(false);
  const [tip, setTip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await api('/api/store/analytics/pulse')).rows || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const periods = useMemo(
    () => [...new Set(rows.map((r) => r.period))].sort(),
    [rows]
  );
  const tiers = useMemo(
    () => [...new Set(rows.map((r) => r.tier))].filter((t) => t !== ALL).sort(),
    [rows]
  );

  const seriesFor = useCallback((field) => {
    const names = byTier ? tiers : [ALL];
    return names.map((name) => ({
      name,
      color: name === ALL ? '#3d8ede' : (TIER_COLORS[name] || '#94a3b8'),
      emphasis: name === ALL,
      values: periods.map((p) => {
        const row = rows.find((r) => r.tier === name && r.period === p);
        return row && row[field] != null ? Number(row[field]) : null;
      }),
    }));
  }, [rows, periods, tiers, byTier]);

  const allRows = rows.filter((r) => r.tier === ALL).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const latest = allRows[allRows.length - 1];
  const prior = allRows[allRows.length - 2];
  const idxDelta = latest?.price_index != null && prior?.price_index != null
    ? Number(latest.price_index) - Number(prior.price_index) : null;
  const stDelta = latest?.sell_through != null && prior?.sell_through != null
    ? Number(latest.sell_through) - Number(prior.sell_through) : null;
  const totalLots = allRows.reduce((s, r) => s + (r.lots || 0), 0);

  return (
    <div>
      <Tip tip={tip} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-sm text-slate-400">
          Direction of travel. The index is mix-adjusted — average and median sale price both move
          when the mix of cars consigned changes, so neither can answer this question.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-slate-700 p-0.5">
            <button onClick={() => setByTier(false)}
              className={`rounded px-3 py-1 text-xs ${!byTier ? 'bg-slate-600 text-white' : 'text-slate-300'}`}>All tiers</button>
            <button onClick={() => setByTier(true)}
              className={`rounded px-3 py-1 text-xs ${byTier ? 'bg-slate-600 text-white' : 'text-slate-300'}`}>By tier</button>
          </div>
          <button onClick={load} className="flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
          {/not configured|does not exist|schema cache/i.test(error) && (
            <div className="mt-1 text-red-200/80">
              Apply <code>supabase_migration_market_pulse.sql</code> in the canonical Supabase project.
            </div>
          )}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
          Nothing to plot yet — the index needs buckets with 3+ settled sales across the window.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Price index · latest quarter"
                  value={latest?.price_index != null ? Number(latest.price_index).toFixed(1) : '—'}
                  sub={idxDelta != null ? `${idxDelta >= 0 ? '▲' : '▼'} ${Math.abs(idxDelta).toFixed(1)} vs prior quarter` : null}
                  dir={idxDelta == null ? null : idxDelta >= 0 ? 'up' : 'down'} />
            <Stat label="Sell-through · latest"
                  value={latest?.sell_through != null ? `${latest.sell_through}%` : '—'}
                  sub={stDelta != null ? `${stDelta >= 0 ? '▲' : '▼'} ${Math.abs(stDelta).toFixed(1)} pts vs prior` : null}
                  dir={stDelta == null ? null : stDelta >= 0 ? 'up' : 'down'} />
            <Stat label="Median price · latest"
                  value={usdShort(latest?.median_price)} sub="raw, not mix-adjusted" />
            <Stat label="Lots in window" value={totalLots.toLocaleString('en-US')}
                  sub={`${periods.length} quarters · ${latest?.buckets_in_period ?? 0} buckets in latest`} />
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Mix-adjusted price index</h3>
            <p className="mb-2 text-xs text-slate-400">
              Base 100 at each series&rsquo; first quarter. Read it for direction and turning points
              rather than as a precise percentage.
            </p>
            <LineChart series={seriesFor('price_index')} periods={periods} height={250}
                       yFmt={(v) => v.toFixed(0)} valueFmt={(v) => (v == null ? '—' : Number(v).toFixed(1))}
                       refY={100} onTip={setTip} label="Index, base 100" />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
              {(byTier ? tiers : [ALL]).map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded" style={{ background: t === ALL ? '#3d8ede' : TIER_COLORS[t] }} />{t}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Sell-through</h3>
            <p className="mb-2 text-xs text-slate-400">
              Share of settled lots meeting reserve, on the same quarters as the chart above. Its own
              axis on its own plot — sellers hold their reserve on the way down, so this usually turns
              before price does, and a shared y-scale would obscure that.
            </p>
            <LineChart series={seriesFor('sell_through')} periods={periods} height={220}
                       yFmt={(v) => `${v.toFixed(0)}%`} valueFmt={(v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)}
                       onTip={setTip} label="Share meeting reserve" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="border-b border-slate-700 bg-slate-800/80">
                <tr>
                  {['Quarter', 'Index', 'Sell-through', 'Lots', 'Sold', 'Median price', 'Buckets in index'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {allRows.map((r) => (
                  <tr key={r.period} className="hover:bg-slate-700/40">
                    <td className="px-3 py-2 text-sm text-white">{shortPeriod(r.period)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-100">{r.price_index != null ? Number(r.price_index).toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{r.sell_through != null ? `${r.sell_through}%` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{r.lots}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{r.sold}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-400">{usdShort(r.median_price)}</td>
                    <td className={`px-3 py-2 font-mono text-sm ${(r.buckets_in_period ?? 0) < 8 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {r.buckets_in_period ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            A bucket contributes to the index only with 3+ settled sales across the window — a
            single-sale bucket has a zero residual by construction and would flatten the index toward
            no change. Quarters resting on fewer than 8 buckets are flagged amber above.
          </p>
        </>
      )}
    </div>
  );
}
