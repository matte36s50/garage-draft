'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { RefreshCw, Gavel } from 'lucide-react';
import { api } from '../lib/adminApi';
import { logTicks, usd, usdShort } from '../lib/chartScales';

/**
 * Live Sales — what the top-tier rooms realized, and how that compares to where
 * the same cars trade online.
 *
 * The comparison is against the bucket's ONLINE median, not the house estimate.
 * The houses read the online market too, so an estimate has already absorbed the
 * signal; comparing to it would measure the estimator, not the room. It also
 * means this board needs no estimates at all, which matters because only ~3% of
 * ended lots carry one.
 *
 * Aggregation lives in Postgres (auction_event_results /
 * auction_bucket_venue_split — supabase_migration_live_sales.sql).
 */

/* Same validated hues as the Comparables tab: all-pairs CVD ΔE 10.2 on slate-800. */
const C = {
  live: '#3d8ede',
  online: '#94a3b8',
  up: '#ef3a32',
  down: '#3d8ede',
  grid: '#334155',
  axis: '#64748b',
};

const bucketName = (b) => [b.make, b.model, b.generation].filter(Boolean).join(' ');

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
        <div key={r.label} className="mt-1 flex items-center gap-3">
          <span className="text-slate-400">{r.label}</span>
          <span className="ml-auto font-mono text-white">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Dumbbell: online median → live median, one row per bucket.
 *
 * A dumbbell is the right form for a paired before/after per item — a grouped
 * bar chart would double the marks and hide the thing that matters, which is
 * the size and direction of the gap.
 */
function VenueDumbbell({ rows, onTip }) {
  const [ref, w] = useWidth();
  const data = useMemo(
    () => rows.filter((r) => r.live_over_online != null && r.online_median > 0 && r.live_median > 0),
    [rows]
  );

  if (data.length === 0) {
    return (
      <div ref={ref} className="flex h-[200px] items-center justify-center px-8 text-center text-sm text-slate-500">
        No bucket yet has both 3+ online sales and 2+ live sales. That overlap is what the
        comparison is built from — until it exists there is nothing honest to plot.
      </div>
    );
  }

  const rowH = 26;
  const m = { t: 26, r: 74, b: 14, l: 190 };
  const H = m.t + m.b + data.length * rowH;
  const iw = Math.max(w - m.l - m.r, 10);

  const all = data.flatMap((r) => [Number(r.online_median), Number(r.live_median)]);
  const lo = Math.min(...all) * 0.88;
  const hi = Math.max(...all) * 1.12;
  const sx = (v) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * iw;

  const ticks = logTicks(lo, hi);

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${H}`} height={H} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={sx(t)} y1={-8} x2={sx(t)} y2={data.length * rowH - 8} stroke={C.grid} strokeWidth={1} />
                <text x={sx(t)} y={-14} textAnchor="middle" fontSize={10.5} fill={C.axis} fontFamily="ui-monospace, monospace">
                  {usdShort(t)}
                </text>
              </g>
            ))}

            {data.map((r, i) => {
              const cy = i * rowH + rowH / 2 - 8;
              const xo = sx(Number(r.online_median));
              const xl = sx(Number(r.live_median));
              const up = Number(r.live_over_online) >= 1;
              return (
                <g key={r.bucket_id}>
                  <text x={-12} y={cy + 4} textAnchor="end" fontSize={11.5} fill="#cbd5e1">
                    {bucketName(r).length > 30 ? `${bucketName(r).slice(0, 29)}…` : bucketName(r)}
                  </text>
                  <line x1={xo} y1={cy} x2={xl} y2={cy}
                        stroke={up ? C.up : C.down} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.5} />
                  <circle cx={xo} cy={cy} r={5} fill={C.online} stroke="#1e293b" strokeWidth={2} />
                  <circle cx={xl} cy={cy} r={5.5} fill={C.live} stroke="#1e293b" strokeWidth={2} />
                  <text x={iw + 10} y={cy + 4} fontSize={11} fontWeight={600}
                        fill={up ? '#fca5a1' : '#93c5fd'} fontFamily="ui-monospace, monospace">
                    {Number(r.live_over_online).toFixed(2)}×
                  </text>
                  <rect x={-m.l} y={i * rowH - 8} width={iw + m.l + m.r} height={rowH} fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onPointerEnter={(e) => onTip({
                          x: e.clientX, y: e.clientY,
                          title: bucketName(r),
                          sub: up ? 'The room paid more' : 'The room paid less',
                          rows: [
                            { label: `Online median (${r.online_n})`, value: usd(r.online_median) },
                            { label: `Live median (${r.live_n})`, value: usd(r.live_median) },
                            { label: 'Live ÷ online', value: `${Number(r.live_over_online).toFixed(2)}×` },
                            { label: 'Top live lot', value: usd(r.live_top) },
                          ],
                        })}
                        onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                        onPointerLeave={() => onTip(null)} />
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function LiveSales() {
  const [events, setEvents] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await api('/api/store/analytics/live');
      setEvents(d.events || []);
      setBuckets(d.buckets || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const lots = events.reduce((s, e) => s + (e.lots || 0), 0);
    const sold = events.reduce((s, e) => s + (e.sold || 0), 0);
    const realized = events.reduce((s, e) => s + Number(e.total_realized || 0), 0);
    const allIn = events.reduce((s, e) => s + (e.all_in_lots || 0), 0);
    const comparable = buckets.filter((b) => b.live_over_online != null);
    const med = comparable.length
      ? [...comparable].map((b) => Number(b.live_over_online)).sort((a, b) => a - b)[Math.floor(comparable.length / 2)]
      : null;
    return { lots, sold, realized, allIn, comparable: comparable.length, med };
  }, [events, buckets]);

  return (
    <div>
      <Tip tip={tip} />

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Results from live auction events, and how the same models price online. Compared against the
          bucket&rsquo;s online median rather than the house estimate — the houses read the online
          market too, so an estimate has already absorbed the signal.
        </p>
        <button onClick={load} className="flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
          {/not configured|does not exist|schema cache/i.test(error) && (
            <div className="mt-1 text-red-200/80">
              Apply <code>supabase_migration_live_sales.sql</code> in the canonical Supabase project —
              it creates <code>auction_event_results</code> and <code>auction_bucket_venue_split</code>.
            </div>
          )}
        </div>
      )}

      {!error && !loading && events.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
          No live auction events in the store yet. Lots are entered through the Live Entry tab.
        </div>
      )}

      {events.length > 0 && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total realized" value={usdShort(totals.realized)} sub={`${totals.sold} of ${totals.lots} lots sold across ${events.length} event${events.length === 1 ? '' : 's'}`} />
            <Stat label="Sell-through" value={totals.lots ? `${Math.round((totals.sold / totals.lots) * 100)}%` : '—'} sub="all live events" />
            <Stat
              label="Median live ÷ online"
              value={totals.med != null ? `${totals.med.toFixed(2)}×` : '—'}
              sub={totals.comparable ? `${totals.comparable} bucket${totals.comparable === 1 ? '' : 's'} comparable` : 'no overlap yet'}
            />
            <Stat
              label="All-in coverage"
              value={totals.lots ? `${Math.round((totals.allIn / totals.lots) * 100)}%` : '—'}
              sub="lots with a buyer premium computed"
            />
          </div>

          {totals.lots > 0 && totals.allIn / totals.lots < 0.9 && (
            <p className="mb-4 rounded-lg border border-amber-800 bg-amber-900/25 p-3 text-xs text-amber-200">
              {totals.lots - totals.allIn} of {totals.lots} live lots have no buyer premium recorded and are
              counted at hammer, while online lots are counted all-in. That understates the live side by
              roughly the premium — around 10–12% at most houses — so the ratios below are conservative.
            </p>
          )}

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Where the room pays more</h3>
            <p className="mb-3 text-xs text-slate-400">
              Online median → live median per bucket, log scale, sorted by the gap. Needs 3+ online and
              2+ live sales to appear.
            </p>
            <VenueDumbbell rows={buckets} onTip={setTip} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.online }} /> Online median
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.live }} /> Live median
              </span>
            </div>
          </div>

          <div className="mb-4 overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="border-b border-slate-700 bg-slate-800/80">
                <tr>
                  {['Sale', 'House', 'Date', 'Lots', 'Sold', 'Sell-through', 'Total realized', 'Median', 'Top lot', 'Bucketed', 'All-in'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {events.map((e) => (
                  <tr key={e.event_id} className="hover:bg-slate-700/40">
                    <td className="px-3 py-2 text-sm text-white">{e.name}</td>
                    <td className="px-3 py-2 text-sm text-slate-300">{e.house || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-400">{e.sale_date || '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-200">{e.lots}</td>
                    <td className="px-3 py-2 font-mono text-sm text-emerald-400">{e.sold}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-200">{e.sell_through != null ? `${e.sell_through}%` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm text-white">{usdShort(e.total_realized)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{usdShort(e.median_realized)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{usdShort(e.top_lot)}</td>
                    <td className={`px-3 py-2 font-mono text-sm ${e.bucketed_pct < 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {e.bucketed_pct != null ? `${e.bucketed_pct}%` : '—'}
                    </td>
                    <td className={`px-3 py-2 font-mono text-sm ${e.all_in_pct < 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {e.all_in_pct != null ? `${e.all_in_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="border-b border-slate-700 bg-slate-800/80">
                <tr>
                  {['Bucket', 'Online lots', 'Online median', 'Live lots', 'Live median', 'Live ÷ online', 'Top live lot'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {buckets.map((b) => (
                  <tr key={b.bucket_id} className="hover:bg-slate-700/40">
                    <td className="px-3 py-2 text-sm text-white">{bucketName(b)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{b.online_n}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{usd(b.online_median)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{b.live_n}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-100">{usd(b.live_median)}</td>
                    <td className="px-3 py-2 font-mono text-sm">
                      {b.live_over_online != null ? (
                        <span className={Number(b.live_over_online) >= 1 ? 'text-red-300' : 'text-sky-300'}>
                          {Number(b.live_over_online).toFixed(2)}×
                        </span>
                      ) : (
                        <span className="text-slate-600" title="Needs 3+ online and 2+ live sales">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{usd(b.live_top)}</td>
                  </tr>
                ))}
                {buckets.length === 0 && !loading && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                    No buckets with live sales yet — live lots need a canonical model assigned in the Review Queue.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
