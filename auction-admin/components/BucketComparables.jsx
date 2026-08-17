'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, RefreshCw, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../lib/adminApi';
import { logTicks, usd as fmtUsd, usdShort as fmtUsdShort } from '../lib/chartScales';

/**
 * Comparables — the bucket drill-down: "what is this specific car worth?"
 *
 * Runs on canonical_model_id, so aliases ("964 C2", "911 Carrera 2") resolve to
 * one comparable set. All aggregation happens in Postgres
 * (auction_bucket_medians / auction_bucket_detail — see
 * supabase_migration_bucket_medians.sql); this component only draws.
 *
 * Design notes that are load-bearing rather than taste:
 *   - Price axes are logarithmic. A bucket routinely spans 5x from project car
 *     to concours; on a linear axis every ordinary lot collapses into a band a
 *     few pixels tall under one outlier.
 *   - Medians, never means. Auction prices are log-normal with a fat right tail.
 *   - Thin groups are withheld, not drawn. The SQL already suppresses year and
 *     quarter groups under 2 sales; the UI says so rather than showing a gap.
 *   - Reserve-not-met lots are plotted at their high bid and keyed separately.
 *     They are excluded from the medians but belong on the chart — hiding them
 *     biases the picture toward cars that found a buyer.
 */

/* Validated against the slate-800 card surface: all-pairs CVD ΔE 10.2,
   normal-vision 17.2, all three ≥3:1 contrast. Do not swap for Tailwind's
   default blue/amber/emerald — those fail the lightness band here. */
const SERIES = {
  sold: '#3d8ede',
  median: '#b8861b',
  band: '#22a37c',
  rnm: '#94a3b8',
};

const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');
const bucketName = (b) =>
  [b.make, b.model, b.generation].filter(Boolean).join(' ') +
  (b.year_min || b.year_max ? ` · ${b.year_min ?? ''}–${b.year_max ?? ''}` : '');

/** Element width, tracked so the SVGs can re-render instead of being squashed. */
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
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs shadow-xl"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <div className="font-semibold text-white">{tip.title}</div>
      {tip.sub && <div className="mt-0.5 text-slate-400">{tip.sub}</div>}
      {tip.rows.map((r) => (
        <div key={r.label} className="mt-1 flex items-center gap-3">
          <span className="text-slate-400">{r.label}</span>
          <span className="ml-auto font-mono text-white">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="flex h-[220px] items-center justify-center px-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/* ------------------------------------------------------- scatter: by model year */

function ScatterByYear({ lots, byYear, onTip }) {
  const [ref, w] = useWidth();
  const pts = useMemo(() => lots.filter((l) => l.year && l.amount > 0), [lots]);

  if (pts.length === 0) {
    return <div ref={ref}><Empty>No settled lots with a model year in this window.</Empty></div>;
  }

  const H = 300;
  const m = { t: 14, r: 16, b: 34, l: 58 };
  const iw = Math.max(w - m.l - m.r, 10);
  const ih = H - m.t - m.b;

  const years = pts.map((p) => p.year);
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  const amounts = pts.map((p) => p.amount);
  const lo = Math.min(...amounts) * 0.85;
  const hi = Math.max(...amounts) * 1.15;

  const sx = (v) => (y1 === y0 ? iw / 2 : ((v - (y0 - 0.6)) / ((y1 + 0.6) - (y0 - 0.6))) * iw);
  const sy = (v) => ih - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * ih;

  const medianPath = byYear
    .filter((r) => r.year >= y0 && r.year <= y1)
    .map((r, i) => `${i ? 'L' : 'M'}${sx(r.year).toFixed(1)} ${sy(r.median).toFixed(1)}`)
    .join(' ');

  // Deterministic horizontal jitter so same-year lots don't stack into one dot.
  const seen = {};
  const placed = pts.map((p) => {
    seen[p.year] = (seen[p.year] || 0) + 1;
    const k = seen[p.year] - 1;
    const offset = ((k % 5) - 2) * 6;
    return { ...p, cx: sx(p.year) + offset, cy: sy(p.amount) };
  });

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${H}`} height={H} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {logTicks(lo, hi).map((t) => (
              <g key={t}>
                <line x1={0} y1={sy(t)} x2={iw} y2={sy(t)} stroke="#334155" strokeWidth={1} />
                <text x={-10} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill="#64748b" fontFamily="ui-monospace, monospace">
                  {fmtUsdShort(t)}
                </text>
              </g>
            ))}
            {Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).map((yr) => (
              <text key={yr} x={sx(yr)} y={ih + 19} textAnchor="middle" fontSize={10.5} fill="#64748b" fontFamily="ui-monospace, monospace">
                {yr}
              </text>
            ))}

            {medianPath && (
              <path d={medianPath} fill="none" stroke={SERIES.median} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            )}

            {placed.map((p) => {
              const rnm = p.outcome === 'reserve_not_met';
              return (
                <circle
                  key={p.id}
                  cx={p.cx}
                  cy={p.cy}
                  r={5}
                  fill={rnm ? 'transparent' : SERIES.sold}
                  fillOpacity={rnm ? 0 : 0.9}
                  stroke={rnm ? SERIES.rnm : '#1e293b'}
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={(e) =>
                    onTip({
                      x: e.clientX,
                      y: e.clientY,
                      title: p.raw_title || `${p.year} lot`,
                      sub: rnm ? 'Reserve not met — shown at high bid' : 'Sold',
                      rows: [
                        { label: 'All-in', value: fmtUsd(p.amount) },
                        { label: 'Model year', value: String(p.year) },
                        { label: 'Sold', value: fmtDate(p.ended_at) },
                      ],
                    })
                  }
                  onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                  onPointerLeave={() => onTip(null)}
                />
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

/* --------------------------------------------------- trend: quarterly median */

function QuarterTrend({ byQuarter, onTip }) {
  const [ref, w] = useWidth();

  if (byQuarter.length < 2) {
    return (
      <div ref={ref}>
        <Empty>
          Needs at least two quarters with 2+ sales each to draw a trend.
          {byQuarter.length === 1 && ' Only one qualifying quarter so far.'}
        </Empty>
      </div>
    );
  }

  const H = 260;
  const m = { t: 16, r: 58, b: 34, l: 58 };
  const iw = Math.max(w - m.l - m.r, 10);
  const ih = H - m.t - m.b;

  const lo = Math.min(...byQuarter.map((r) => r.p25)) * 0.9;
  const hi = Math.max(...byQuarter.map((r) => r.p75)) * 1.1;
  const sx = (i) => (byQuarter.length === 1 ? iw / 2 : (i / (byQuarter.length - 1)) * iw);
  const sy = (v) => ih - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * ih;

  const line = byQuarter.map((r, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(r.median).toFixed(1)}`).join(' ');
  const band =
    `M${byQuarter.map((r, i) => `${sx(i).toFixed(1)} ${sy(r.p75).toFixed(1)}`).join(' L')}` +
    ` L${byQuarter.slice().reverse().map((r, i) => `${sx(byQuarter.length - 1 - i).toFixed(1)} ${sy(r.p25).toFixed(1)}`).join(' L')} Z`;

  const last = byQuarter[byQuarter.length - 1];

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${H}`} height={H} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {logTicks(lo, hi).map((t) => (
              <g key={t}>
                <line x1={0} y1={sy(t)} x2={iw} y2={sy(t)} stroke="#334155" strokeWidth={1} />
                <text x={-10} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill="#64748b" fontFamily="ui-monospace, monospace">
                  {fmtUsdShort(t)}
                </text>
              </g>
            ))}

            <path d={band} fill={SERIES.band} fillOpacity={0.13} stroke="none" />
            <path d={line} fill="none" stroke={SERIES.band} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {byQuarter.map((r, i) => (
              <g key={r.quarter}>
                <circle cx={sx(i)} cy={sy(r.median)} r={4} fill={SERIES.band} stroke="#1e293b" strokeWidth={2} />
                <text x={sx(i)} y={ih + 19} textAnchor="middle" fontSize={10.5} fill="#64748b" fontFamily="ui-monospace, monospace">
                  {String(r.quarter).slice(2, 7)}
                </text>
                <rect
                  x={sx(i) - iw / (byQuarter.length * 2)}
                  y={0}
                  width={iw / byQuarter.length}
                  height={ih}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={(e) =>
                    onTip({
                      x: e.clientX,
                      y: e.clientY,
                      title: String(r.quarter).slice(0, 7),
                      sub: `${r.n} sale${r.n === 1 ? '' : 's'}`,
                      rows: [
                        { label: 'Median', value: fmtUsd(r.median) },
                        { label: 'p25 – p75', value: `${fmtUsdShort(r.p25)} – ${fmtUsdShort(r.p75)}` },
                      ],
                    })
                  }
                  onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                  onPointerLeave={() => onTip(null)}
                />
              </g>
            ))}

            <text
              x={iw + 8}
              y={sy(last.median) + 4}
              fontSize={11}
              fontWeight={600}
              fill="#cbd5e1"
              fontFamily="ui-monospace, monospace"
            >
              {fmtUsdShort(last.median)}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ stat tile */

function Stat({ label, value, sub, delta }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {delta != null && (
        <div className={`mt-1 flex items-center gap-1 font-mono text-xs ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {delta >= 0 ? '+' : ''}{delta}% vs prior 12m
        </div>
      )}
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- the tab */

export default function BucketComparables() {
  const [buckets, setBuckets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [months, setMonths] = useState(24);
  const [q, setQ] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    (async () => {
      setLoadingList(true); setError(null);
      try {
        const d = await api('/api/store/analytics/bucket');
        setBuckets(d.rows || []);
        const firstUsable = (d.rows || []).find((b) => (b.sold_12m || 0) >= 3) || (d.rows || [])[0];
        if (firstUsable) setSelected(firstUsable.bucket_id);
      } catch (e) { setError(e.message); }
      setLoadingList(false);
    })();
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setLoadingDetail(true); setError(null);
    try {
      setDetail(await api(`/api/store/analytics/bucket?id=${selected}&months=${months}`));
    } catch (e) { setError(e.message); setDetail(null); }
    setLoadingDetail(false);
  }, [selected, months]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return buckets;
    return buckets.filter((b) => bucketName(b).toLowerCase().includes(needle));
  }, [buckets, q]);

  const b = detail?.bucket;
  const lots = detail?.lots || [];
  const byYear = detail?.by_year || [];
  const byQuarter = detail?.by_quarter || [];
  const thin = b && (b.sold_12m ?? 0) < 3;

  return (
    <div>
      <Tip tip={tip} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a bucket…"
            className="w-64 rounded border border-slate-600 bg-slate-700 py-1.5 pl-8 pr-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={selected || ''}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-[300px] rounded border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
        >
          {filtered.map((x) => (
            <option key={x.bucket_id} value={x.bucket_id}>
              {bucketName(x)} — {x.sold_12m || 0} sold
            </option>
          ))}
        </select>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
        >
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
          <option value={60}>5 years</option>
        </select>
        <button
          onClick={loadDetail}
          className="flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
        >
          <RefreshCw size={14} className={loadingDetail ? 'animate-spin' : ''} /> Refresh
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {loadingList ? 'Loading buckets…' : `${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
          {/not configured|does not exist|schema cache/i.test(error) && (
            <div className="mt-1 text-red-200/80">
              If this is the first run, apply <code>supabase_migration_bucket_medians.sql</code> in the
              canonical Supabase project — it creates <code>auction_bucket_medians</code> and
              <code> auction_bucket_detail()</code>.
            </div>
          )}
        </div>
      )}

      {!error && !loadingList && buckets.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
          No buckets yet. Create them in the Buckets tab and assign listings from the Review Queue —
          comparables need a canonical model to group by.
        </div>
      )}

      {b && (
        <>
          {thin && (
            <div className="mb-3 rounded-lg border border-amber-800 bg-amber-900/25 p-3 text-sm text-amber-200">
              Only {b.sold_12m ?? 0} settled sale{(b.sold_12m ?? 0) === 1 ? '' : 's'} in the last 12 months.
              Treat the median as indicative — no year-over-year change is shown below three sales in both windows.
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Median all-in · trailing 12m"
              value={fmtUsdShort(b.median_12m)}
              delta={b.change_pct_12m}
              sub={`${b.sold_12m || 0} settled sale${(b.sold_12m || 0) === 1 ? '' : 's'}`}
            />
            <Stat
              label="Interquartile range"
              value={b.iqr_12m ? fmtUsdShort(b.iqr_12m) : '—'}
              sub={b.p25_12m ? `${fmtUsdShort(b.p25_12m)} – ${fmtUsdShort(b.p75_12m)}` : 'needs more sales'}
            />
            <Stat
              label="Sell-through · 12m"
              value={b.sell_through_12m != null ? `${b.sell_through_12m}%` : '—'}
              sub={`${b.sold_12m || 0} of ${b.lots_12m || 0} lots met reserve`}
            />
            <Stat
              label="Lots in window"
              value={String(lots.length)}
              sub={`last ${detail.months} months · ${byQuarter.length} quarter${byQuarter.length === 1 ? '' : 's'} chartable`}
            />
          </div>

          {b.lots_missing_all_in > 0 && (
            <p className="mb-4 text-xs text-slate-500">
              {b.lots_missing_all_in} of {b.sold_12m} sold lots have no buyer premium recorded and are
              valued at hammer, which understates the medians above slightly.
            </p>
          )}

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Every settled lot by model year</h3>
            <p className="mb-2 text-xs text-slate-400">
              All-in price, log scale. The line is the median per model year, drawn only where 2+ lots sold.
            </p>
            <ScatterByYear lots={lots} byYear={byYear} onTip={setTip} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES.sold }} /> Sold
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full ring-2 ring-inset" style={{ boxShadow: `inset 0 0 0 2px ${SERIES.rnm}` }} />
                Reserve not met (high bid)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded" style={{ background: SERIES.median }} /> Median by year
              </span>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Median over time</h3>
            <p className="mb-2 text-xs text-slate-400">
              Quarterly median with the interquartile band. The band is the honesty check — a move
              inside it is not yet a trend.
            </p>
            <QuarterTrend byQuarter={byQuarter} onTip={setTip} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="border-b border-slate-700 bg-slate-800/80">
                <tr>
                  {['Sold', 'Lot', 'Year', 'Hammer', 'All-in', 'vs median', 'Outcome', 'Source', ''].map((hd) => (
                    <th key={hd} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {lots.map((l) => {
                  const vs = b.median_12m ? l.amount / b.median_12m : null;
                  return (
                    <tr key={l.id} className="hover:bg-slate-700/40">
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-200">{fmtDate(l.ended_at)}</td>
                      <td className="px-3 py-2 text-sm text-slate-300" title={l.raw_title || ''}>
                        <span className="block max-w-[280px] truncate">{l.raw_title || l.source_listing_id}</span>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-200">{l.year ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-sm text-slate-300">{fmtUsd(l.price)}</td>
                      <td className="px-3 py-2 font-mono text-sm text-slate-100">{fmtUsd(l.price_all_in ?? l.amount)}</td>
                      <td className="px-3 py-2 font-mono text-sm">
                        {vs ? (
                          <span className={vs >= 1 ? 'text-emerald-400' : 'text-sky-400'}>{vs.toFixed(2)}×</span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                          l.outcome === 'sold' ? 'bg-emerald-900/40 text-emerald-300'
                          : l.outcome === 'reserve_not_met' ? 'bg-amber-900/40 text-amber-300'
                          : 'bg-slate-700 text-slate-300'}`}>
                          {l.outcome || 'unknown'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-400">{l.source_id}</td>
                      <td className="px-3 py-2">
                        {l.url && (
                          <a href={l.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {lots.length === 0 && !loadingDetail && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                      No settled lots for this bucket in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
