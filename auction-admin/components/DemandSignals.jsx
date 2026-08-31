'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/adminApi';

/**
 * Demand Signals — does watcher count predict what a lot sells for?
 *
 * Outcome is price ÷ the lot's bucket median, never price ÷ estimate: BaT and
 * Cars & Bids publish no estimate and are where the watcher data comes from.
 * Deciles are ranked within (price band, quarter) so each decile carries a
 * comparable mix of models rather than the cheapest cars at one end and the
 * dearest at the other.
 *
 * The bias this cannot fix is stated on the page, not buried here: watchers
 * are scraped at finalisation, so they are a CLOSING count and partly an
 * effect of the bidding they are being used to predict.
 *
 * Aggregation lives in Postgres (auction_watcher_deciles /
 * auction_watcher_coverage — supabase_migration_watcher_signal.sql).
 */

/* Diverging about the 1.0× baseline — same language as the other boards:
   warm = sold above its bucket median, cool = below. Validated on slate-800. */
const WARM = '#ef3a32';
const COOL = '#3d8ede';
const GRID = '#334155';
const AXIS = '#64748b';

const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const ratio = (v) => (v == null ? '—' : `${Number(v).toFixed(2)}×`);

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

/** Columns diverging from the 1.0× baseline — the value has a sign, so the form should show it. */
function DecileColumns({ rows, onTip }) {
  const [ref, w] = useWidth();
  const data = useMemo(() => rows.filter((r) => r.median_ratio != null), [rows]);
  if (data.length === 0) {
    return <div ref={ref} className="flex h-[220px] items-center justify-center text-sm text-slate-500">No decile has enough sold lots to report a median yet.</div>;
  }

  const H = 280;
  const m = { t: 22, r: 16, b: 40, l: 52 };
  const iw = Math.max(w - m.l - m.r, 10);
  const ih = H - m.t - m.b;

  const vals = data.map((r) => Number(r.median_ratio));
  const lo = Math.min(0.9, Math.min(...vals) - 0.05);
  const hi = Math.max(1.1, Math.max(...vals) + 0.08);
  const sy = (v) => ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / data.length;
  const bw = Math.min(30, band - 10);

  const ticks = [];
  for (let t = Math.ceil(lo * 10) / 10; t <= hi; t += 0.1) ticks.push(Math.round(t * 10) / 10);

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${H}`} height={H} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} y1={sy(t)} x2={iw} y2={sy(t)} stroke={GRID} strokeWidth={1} />
                <text x={-10} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">
                  {t.toFixed(1)}×
                </text>
              </g>
            ))}
            <line x1={0} y1={sy(1)} x2={iw} y2={sy(1)} stroke="#94a3b8" strokeWidth={1} />
            <text x={2} y={sy(1) - 6} fontSize={10.5} fontWeight={600} fill="#94a3b8">bucket median</text>

            {data.map((r, i) => {
              const v = Number(r.median_ratio);
              const cx = band * i + band / 2;
              const top = Math.min(sy(v), sy(1));
              const bot = Math.max(sy(v), sy(1));
              const up = v >= 1;
              const color = up ? WARM : COOL;
              return (
                <g key={r.decile}>
                  <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} rx={3} fill={color} />
                  <text x={cx} y={ih + 18} textAnchor="middle" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">
                    D{r.decile}
                  </text>
                  {(i === 0 || i === data.length - 1) && (
                    <text x={cx} y={up ? top - 7 : bot + 15} textAnchor="middle" fontSize={11} fontWeight={600} fill="#e2e8f0" fontFamily="ui-monospace, monospace">
                      {ratio(v)}
                    </text>
                  )}
                  <rect x={band * i} y={0} width={band} height={ih} fill="transparent" style={{ cursor: 'pointer' }}
                    onPointerEnter={(e) => onTip({
                      x: e.clientX, y: e.clientY,
                      title: `Watcher decile ${r.decile}${r.decile === 10 ? ' — most watched' : r.decile === 1 ? ' — least watched' : ''}`,
                      sub: `${num(r.min_watchers)}–${num(r.max_watchers)} watchers`,
                      rows: [
                        { label: 'vs bucket median', value: ratio(r.median_ratio) },
                        { label: 'Sell-through', value: r.sell_through != null ? `${r.sell_through}%` : '—' },
                        { label: 'Lots', value: num(r.lots) },
                        { label: 'Sold', value: num(r.sold) },
                      ],
                    })}
                    onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                    onPointerLeave={() => onTip(null)} />
                </g>
              );
            })}
            <text x={iw / 2} y={ih + 36} textAnchor="middle" fontSize={11} fill={AXIS}>
              Watcher decile, ranked within price band and quarter
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}

/** Sell-through by decile — its own chart, on its own axis. Never a second y-scale. */
function SellThroughLine({ rows, onTip }) {
  const [ref, w] = useWidth();
  const data = useMemo(() => rows.filter((r) => r.sell_through != null), [rows]);
  if (data.length < 2) {
    return <div ref={ref} className="flex h-[180px] items-center justify-center text-sm text-slate-500">Not enough deciles to draw a trend.</div>;
  }

  const H = 200;
  const m = { t: 18, r: 40, b: 34, l: 52 };
  const iw = Math.max(w - m.l - m.r, 10);
  const ih = H - m.t - m.b;
  const vals = data.map((r) => Number(r.sell_through));
  const lo = Math.max(0, Math.min(...vals) - 6);
  const hi = Math.min(100, Math.max(...vals) + 6);
  const sx = (i) => (i / (data.length - 1)) * iw;
  const sy = (v) => ih - ((v - lo) / (hi - lo)) * ih;
  const path = data.map((r, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(Number(r.sell_through)).toFixed(1)}`).join(' ');

  const ticks = [];
  const step = Math.max(5, Math.round((hi - lo) / 4 / 5) * 5);
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${H}`} height={H} className="block w-full overflow-visible">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} y1={sy(t)} x2={iw} y2={sy(t)} stroke={GRID} strokeWidth={1} />
                <text x={-10} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">{t}%</text>
              </g>
            ))}
            <path d={path} fill="none" stroke="#22a37c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {data.map((r, i) => (
              <g key={r.decile}>
                <circle cx={sx(i)} cy={sy(Number(r.sell_through))} r={4} fill="#22a37c" stroke="#1e293b" strokeWidth={2} />
                <text x={sx(i)} y={ih + 18} textAnchor="middle" fontSize={10.5} fill={AXIS} fontFamily="ui-monospace, monospace">D{r.decile}</text>
                <rect x={sx(i) - iw / (data.length * 2)} y={0} width={iw / data.length} height={ih} fill="transparent" style={{ cursor: 'pointer' }}
                  onPointerEnter={(e) => onTip({
                    x: e.clientX, y: e.clientY,
                    title: `Watcher decile ${r.decile}`,
                    sub: `${num(r.lots)} lots`,
                    rows: [
                      { label: 'Sell-through', value: `${r.sell_through}%` },
                      { label: 'vs bucket median', value: ratio(r.median_ratio) },
                    ],
                  })}
                  onPointerMove={(e) => onTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                  onPointerLeave={() => onTip(null)} />
              </g>
            ))}
            <text x={iw + 8} y={sy(Number(data[data.length - 1].sell_through)) + 4} fontSize={11} fontWeight={600}
                  fill="#cbd5e1" fontFamily="ui-monospace, monospace">
              {data[data.length - 1].sell_through}%
            </text>
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

export default function DemandSignals() {
  const [deciles, setDeciles] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await api('/api/store/analytics/demand');
      setDeciles(d.deciles || []);
      setCoverage(d.coverage || null);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const top = deciles.find((r) => r.decile === 10);
  const bottom = deciles.find((r) => r.decile === 1);
  const spread = top?.median_ratio != null && bottom?.median_ratio != null
    ? Number(top.median_ratio) - Number(bottom.median_ratio) : null;

  return (
    <div>
      <Tip tip={tip} />

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Whether the engagement you already collect predicts what a lot sells for. Outcome is
          price ÷ the lot&rsquo;s bucket median — BaT and Cars &amp; Bids publish no estimate, so an
          estimate ratio would cover almost nothing.
        </p>
        <button onClick={load} className="flex flex-shrink-0 items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
          {/not configured|does not exist|schema cache/i.test(error) && (
            <div className="mt-1 text-red-200/80">
              Apply <code>supabase_migration_watcher_signal.sql</code> in the canonical Supabase project.
            </div>
          )}
        </div>
      )}

      {!error && !loading && deciles.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
          No decile cleared the sample floor. Each (price band, quarter) group needs 20+ lots with a
          watcher count in a bucket that has 4+ settled sales.
        </div>
      )}

      {deciles.length > 0 && (
        <>
          {/* The caveat is not a footnote: it changes what the charts below mean. */}
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-900/25 p-3 text-xs text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              <strong>Descriptive, not predictive.</strong> <code>watchers</code> is scraped when the
              auction ends, so it is a <em>closing</em> count — a lot accumulates watchers partly
              because it is bidding up. The relationship below is therefore an upper bound on the
              forecasting signal. Snapshotting watchers before close (T-48h, alongside the existing
              <code> price_at_48h</code>) would make this genuinely predictive; it is forward-only and
              cannot be recovered for past lots.
            </span>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Top decile vs bucket median" value={ratio(top?.median_ratio)}
                  sub={top ? `${num(top.min_watchers)}+ watchers` : null} />
            <Stat label="Bottom decile" value={ratio(bottom?.median_ratio)}
                  sub={bottom ? `up to ${num(bottom.max_watchers)} watchers` : null} />
            <Stat label="Spread across deciles"
                  value={spread != null ? `${spread >= 0 ? '+' : ''}${(spread * 100).toFixed(0)} pts` : '—'}
                  sub="top minus bottom" />
            <Stat label="Lots in scope" value={num(coverage?.in_scope)}
                  sub={coverage ? `${num(coverage.buckets_in_scope)} buckets · ${num(coverage.quarters)} quarters` : null} />
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Sale price by watcher decile</h3>
            <p className="mb-2 text-xs text-slate-400">
              Median price ÷ bucket median. Bars diverge from the bucket median, so height is the size
              of the effect and side is its direction.
            </p>
            <DecileColumns rows={deciles} onTip={setTip} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: WARM }} /> Sold above its bucket median</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: COOL }} /> Sold below</span>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-white">Sell-through by watcher decile</h3>
            <p className="mb-2 text-xs text-slate-400">
              Share meeting reserve. Its own chart on its own axis — pairing it with price on one plot
              would need a second y-scale, whose alignment would be arbitrary.
            </p>
            <SellThroughLine rows={deciles} onTip={setTip} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="border-b border-slate-700 bg-slate-800/80">
                <tr>
                  {['Decile', 'Watcher range', 'Lots', 'Sold', 'Sell-through', 'vs bucket median'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {deciles.map((r) => (
                  <tr key={r.decile} className="hover:bg-slate-700/40">
                    <td className="px-3 py-2 text-sm text-white">D{r.decile}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{num(r.min_watchers)}–{num(r.max_watchers)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{num(r.lots)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{num(r.sold)}</td>
                    <td className="px-3 py-2 font-mono text-sm text-slate-300">{r.sell_through != null ? `${r.sell_through}%` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm">
                      <span className={Number(r.median_ratio) >= 1 ? 'text-red-300' : 'text-sky-300'}>{ratio(r.median_ratio)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {coverage && (
            <p className="mt-3 text-xs text-slate-500">
              Built from {num(coverage.in_scope)} of {num(coverage.ended_12m)} lots settled in the last 12 months.
              Excluded: {num(coverage.no_watchers)} with no watcher count, {num(coverage.no_bucket)} with no
              canonical model, {num(coverage.thin_bucket)} in a bucket with fewer than 4 settled sales.
            </p>
          )}
        </>
      )}
    </div>
  );
}
