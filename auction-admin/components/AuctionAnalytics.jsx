'use client'
import React, { useState, useEffect, useMemo } from 'react';
import { Search, TrendingUp, TrendingDown, DollarSign, BarChart2, RefreshCw, ChevronUp, ChevronDown, ExternalLink, Car, Award, Percent } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine, Cell
} from 'recharts';

const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString()}`;
const pct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, idx)];
}

const StatCard = ({ label, value, sub, color = 'blue' }) => {
  const colors = {
    blue: 'border-blue-500 text-blue-400',
    green: 'border-green-500 text-green-400',
    red: 'border-red-500 text-red-400',
    yellow: 'border-yellow-500 text-yellow-400',
    purple: 'border-purple-500 text-purple-400',
  };
  return (
    <div className={`bg-slate-800 border-l-4 ${colors[color]} rounded-lg p-4`}>
      <div className="text-slate-400 text-xs uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colors[color].split(' ')[1]}`}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded p-3 text-xs shadow-lg max-w-[220px]">
      <div className="font-semibold text-white mb-1 truncate">{d.title}</div>
      <div className="text-slate-300">{[d.year, d.make, d.model].filter(Boolean).join(' ') || '—'}</div>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">Estimate</span>
          <span className="text-white">{fmt(d.estimate)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-green-400">Final</span>
          <span className="text-white">{fmt(d.final)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-yellow-400">Variance</span>
          <span className={d.variance >= 0 ? 'text-green-400' : 'text-red-400'}>{pct(d.variance)}</span>
        </div>
      </div>
    </div>
  );
};

const ScatterTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded p-3 text-xs shadow-lg max-w-[220px]">
      <div className="font-semibold text-white mb-1 truncate">{d.title}</div>
      <div className="text-slate-300">{[d.year, d.make, d.model].filter(Boolean).join(' ') || '—'}</div>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">Estimate</span><span className="text-white">{fmt(d.x)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-green-400">Final</span><span className="text-white">{fmt(d.y)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-yellow-400">Variance</span>
          <span className={d.variance >= 0 ? 'text-green-400' : 'text-red-400'}>{pct(d.variance)}</span>
        </div>
      </div>
    </div>
  );
};

const MakeTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded p-3 text-xs shadow-lg">
      <div className="font-semibold text-white mb-1">{d.make}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4"><span className="text-slate-400">Auctions</span><span className="text-white">{d.count}</span></div>
        <div className="flex justify-between gap-4"><span className="text-green-400">Sell-through</span><span className="text-white">{d.sellThrough.toFixed(0)}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-blue-400">Avg variance</span><span className={d.avgVariance >= 0 ? 'text-green-400' : 'text-red-400'}>{pct(d.avgVariance)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-purple-400">Median final</span><span className="text-white">{fmt(d.medianFinal)}</span></div>
      </div>
    </div>
  );
};

// Price brackets for distribution
const PRICE_BRACKETS = [
  { label: '<$10k', min: 0, max: 10000 },
  { label: '$10k–$25k', min: 10000, max: 25000 },
  { label: '$25k–$50k', min: 25000, max: 50000 },
  { label: '$50k–$100k', min: 50000, max: 100000 },
  { label: '$100k–$250k', min: 100000, max: 250000 },
  { label: '$250k+', min: 250000, max: Infinity },
];

export default function AuctionAnalytics() {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchMake, setSearchMake] = useState('');
  const [searchModel, setSearchModel] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [searchTitle, setSearchTitle] = useState('');
  const [searchRef, setSearchRef] = useState('');
  const [sortField, setSortField] = useState('timestamp_end');
  const [sortDir, setSortDir] = useState('desc');
  const [chartView, setChartView] = useState('bar'); // 'bar' | 'scatter'
  const [limit, setLimit] = useState(200);
  const [activeSection, setActiveSection] = useState('overview'); // 'overview' | 'byMake' | 'financial'
  const [makeSortField, setMakeSortField] = useState('count');
  const [makeSortDir, setMakeSortDir] = useState('desc');
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase
        .from('auctions')
        .select('auction_id, title, make, model, year, price_at_48h, final_price, current_bid, reserve_not_met, timestamp_end, inserted_at, auction_reference, url')
        .not('final_price', 'is', null)
        .order('timestamp_end', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setAuctions(data || []);
    } catch (err) {
      console.error('Failed to load analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [limit]);

  const runBackfill = async (dryRun = false) => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/admin/backfill-makes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100, dry_run: dryRun }),
      });
      const data = await res.json();
      setBackfillResult(data);
      if (!dryRun && data.updated > 0) {
        // Reload auction data to reflect updates
        loadData();
      }
    } catch (err) {
      setBackfillResult({ error: err.message });
    } finally {
      setBackfilling(false);
    }
  };

  // Derive unique makes for datalist
  const makes = useMemo(() => [...new Set(auctions.map(a => a.make).filter(Boolean))].sort(), [auctions]);

  // Derive unique auction references for dropdown, sorted alphabetically
  const auctionRefs = useMemo(() =>
    [...new Set(auctions.map(a => a.auction_reference).filter(Boolean))].sort(),
    [auctions]
  );

  // Filtered auctions
  const filtered = useMemo(() => {
    return auctions.filter(a => {
      if (searchMake && !a.make?.toLowerCase().includes(searchMake.toLowerCase())) return false;
      if (searchModel && !a.model?.toLowerCase().includes(searchModel.toLowerCase())) return false;
      if (searchYear && String(a.year) !== searchYear) return false;
      if (searchTitle && !a.title?.toLowerCase().includes(searchTitle.toLowerCase())) return false;
      if (searchRef && a.auction_reference !== searchRef) return false;
      return true;
    });
  }, [auctions, searchMake, searchModel, searchYear, searchTitle, searchRef]);

  // Enriched rows with computed fields
  const rows = useMemo(() => {
    return filtered.map(a => {
      const estimate = a.price_at_48h;
      const final = a.final_price;
      const variance = estimate && final ? ((final - estimate) / estimate) * 100 : null;
      const sold = !a.reserve_not_met && final > 0;
      return { ...a, estimate, final, variance, sold };
    });
  }, [filtered]);

  // Sort rows
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (av == null) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [rows, sortField, sortDir]);

  // Summary stats
  const stats = useMemo(() => {
    const withBoth = rows.filter(r => r.estimate != null && r.final != null && r.final > 0);
    const sold = rows.filter(r => r.sold);
    const rnm = rows.filter(r => r.reserve_not_met);
    const variances = withBoth.map(r => r.variance).filter(v => v != null);
    const avgVariance = variances.length ? variances.reduce((s, v) => s + v, 0) / variances.length : null;
    const avgEstimate = withBoth.length ? withBoth.reduce((s, r) => s + r.estimate, 0) / withBoth.length : null;
    const avgFinal = withBoth.length ? withBoth.reduce((s, r) => s + r.final, 0) / withBoth.length : null;
    const over = variances.filter(v => v > 0).length;
    const under = variances.filter(v => v < 0).length;
    return { total: rows.length, sold: sold.length, rnm: rnm.length, avgVariance, avgEstimate, avgFinal, over, under, withBoth: withBoth.length };
  }, [rows]);

  // Bar chart data - 30 most recent
  const barData = useMemo(() => {
    return rows
      .filter(r => r.estimate && r.final && r.final > 0)
      .sort((a, b) => (b.timestamp_end || 0) - (a.timestamp_end || 0))
      .slice(0, 30)
      .map(r => ({
        name: `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim().slice(0, 22) || r.title?.slice(0, 22) || '—',
        title: r.title,
        year: r.year,
        make: r.make,
        model: r.model,
        estimate: r.estimate,
        final: r.final,
        variance: r.variance,
      }));
  }, [rows]);

  // Scatter chart data
  const scatterData = useMemo(() => {
    return rows
      .filter(r => r.estimate && r.final && r.final > 0)
      .map(r => ({
        x: r.estimate,
        y: r.final,
        title: r.title,
        year: r.year,
        make: r.make,
        model: r.model,
        variance: r.variance,
      }));
  }, [rows]);

  // --- By Manufacturer stats ---
  const makeStats = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const key = r.make || '(unknown)';
      if (!map[key]) map[key] = { make: key, count: 0, soldCount: 0, rnmCount: 0, finals: [], variances: [], estimates: [] };
      const m = map[key];
      m.count++;
      if (r.sold) { m.soldCount++; m.finals.push(r.final); }
      if (r.reserve_not_met) m.rnmCount++;
      if (r.variance != null) m.variances.push(r.variance);
      if (r.estimate) m.estimates.push(r.estimate);
    });

    return Object.values(map).map(m => ({
      make: m.make,
      count: m.count,
      soldCount: m.soldCount,
      rnmCount: m.rnmCount,
      sellThrough: m.count > 0 ? (m.soldCount / m.count) * 100 : 0,
      avgVariance: m.variances.length ? m.variances.reduce((s, v) => s + v, 0) / m.variances.length : null,
      medianVariance: median(m.variances),
      avgFinal: m.finals.length ? m.finals.reduce((s, v) => s + v, 0) / m.finals.length : null,
      medianFinal: median(m.finals),
      maxFinal: m.finals.length ? Math.max(...m.finals) : null,
      avgEstimate: m.estimates.length ? m.estimates.reduce((s, v) => s + v, 0) / m.estimates.length : null,
      totalVolume: m.finals.reduce((s, v) => s + v, 0),
    }));
  }, [rows]);

  // Sorted make stats
  const sortedMakeStats = useMemo(() => {
    return [...makeStats].sort((a, b) => {
      let av = a[makeSortField], bv = b[makeSortField];
      if (av == null) av = makeSortDir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = makeSortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return makeSortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [makeStats, makeSortField, makeSortDir]);

  // Top 8 makes by count for bar chart
  const topMakeBarData = useMemo(() => {
    return [...makeStats]
      .filter(m => m.make !== '(unknown)' && m.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(m => ({
        make: m.make,
        count: m.count,
        sellThrough: parseFloat(m.sellThrough.toFixed(1)),
        avgVariance: m.avgVariance != null ? parseFloat(m.avgVariance.toFixed(1)) : 0,
        medianFinal: m.medianFinal,
      }));
  }, [makeStats]);

  // --- Financial Analysis ---
  const financialStats = useMemo(() => {
    const soldRows = rows.filter(r => r.sold && r.final > 0);
    const finals = soldRows.map(r => r.final);
    const variances = rows.filter(r => r.variance != null && r.sold).map(r => r.variance);
    const estimates = rows.filter(r => r.estimate).map(r => r.estimate);

    // Price brackets
    const brackets = PRICE_BRACKETS.map(b => ({
      label: b.label,
      sold: soldRows.filter(r => r.final >= b.min && r.final < b.max).length,
      total: rows.filter(r => {
        const price = r.final || r.estimate || 0;
        return price >= b.min && price < b.max;
      }).length,
    }));

    // Top over/under performers by variance %
    const withVariance = rows.filter(r => r.variance != null && r.sold);
    const topOver = [...withVariance].sort((a, b) => b.variance - a.variance).slice(0, 5);
    const topUnder = [...withVariance].sort((a, b) => a.variance - b.variance).slice(0, 5);

    // Price multiples (final / estimate)
    const multiples = rows
      .filter(r => r.estimate && r.final && r.final > 0)
      .map(r => r.final / r.estimate);
    const avgMultiple = multiples.length ? multiples.reduce((s, v) => s + v, 0) / multiples.length : null;

    return {
      medianFinal: median(finals),
      p75Final: percentile(finals, 75),
      p90Final: percentile(finals, 90),
      medianEstimate: median(estimates),
      medianVariance: median(variances),
      brackets,
      topOver,
      topUnder,
      avgMultiple,
      totalVolume: finals.reduce((s, v) => s + v, 0),
    };
  }, [rows]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const toggleMakeSort = (field) => {
    if (makeSortField === field) setMakeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMakeSortField(field); setMakeSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronUp size={12} className="text-slate-600" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-400" /> : <ChevronDown size={12} className="text-blue-400" />;
  };

  const MakeSortIcon = ({ field }) => {
    if (makeSortField !== field) return <ChevronUp size={12} className="text-slate-600" />;
    return makeSortDir === 'asc' ? <ChevronUp size={12} className="text-blue-400" /> : <ChevronDown size={12} className="text-blue-400" />;
  };

  const ThBtn = ({ field, children }) => (
    <th
      className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white select-none"
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">{children}<SortIcon field={field} /></span>
    </th>
  );

  const MakeThBtn = ({ field, children }) => (
    <th
      className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white select-none"
      onClick={() => toggleMakeSort(field)}
    >
      <span className="flex items-center gap-1">{children}<MakeSortIcon field={field} /></span>
    </th>
  );

  const SECTION_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'byMake', label: 'By Manufacturer' },
    { id: 'financial', label: 'Financial Analysis' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={22} className="text-blue-400" />
            Auction Analytics
          </h2>
          <p className="text-slate-400 text-sm mt-0.5">Completed auctions — estimate vs. final price analysis</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="bg-slate-800 text-slate-300 border border-slate-700 rounded px-3 py-1.5 text-sm"
          >
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
          <button
            onClick={() => runBackfill(false)}
            disabled={backfilling}
            title="Fill in missing make/model/year for auctions with null values"
            className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm"
          >
            <Car size={14} className={backfilling ? 'animate-pulse' : ''} />
            {backfilling ? 'Backfilling…' : 'Backfill Makes'}
          </button>
          <button
            onClick={loadData}
            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Backfill result banner */}
      {backfillResult && (
        <div className={`rounded-lg p-4 flex items-start justify-between gap-4 text-sm ${
          backfillResult.error
            ? 'bg-red-900/40 border border-red-700 text-red-300'
            : 'bg-purple-900/40 border border-purple-700 text-purple-200'
        }`}>
          <div>
            {backfillResult.error ? (
              <span>Backfill error: {backfillResult.error}</span>
            ) : (
              <span>
                Backfill complete — <strong>{backfillResult.updated}</strong> updated,{' '}
                <strong>{backfillResult.failed}</strong> failed,{' '}
                <strong>{backfillResult.skipped}</strong> skipped
                {backfillResult.dry_run && ' (dry run — no changes written)'}
              </span>
            )}
            {backfillResult.results && backfillResult.results.filter(r => r.updated).length > 0 && (
              <div className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
                {backfillResult.results.filter(r => r.updated).slice(0, 10).map(r => (
                  <div key={r.auction_id} className="text-xs text-purple-300 font-mono">
                    {r.found?.make || '?'} / {r.found?.model || '?'} / {r.found?.year || '?'} — {r.title?.slice(0, 50)}
                  </div>
                ))}
                {backfillResult.updated > 10 && (
                  <div className="text-xs text-purple-400">…and {backfillResult.updated - 10} more</div>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setBackfillResult(null)} className="text-purple-400 hover:text-white flex-shrink-0">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3 text-sm text-slate-400 font-medium">
          <Search size={14} />
          Filter Auctions
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Title / Keywords</label>
            <input
              value={searchTitle}
              onChange={e => setSearchTitle(e.target.value)}
              placeholder="e.g. Porsche 911"
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Manufacturer / Make</label>
            <input
              list="make-list"
              value={searchMake}
              onChange={e => setSearchMake(e.target.value)}
              placeholder="e.g. Ferrari"
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <datalist id="make-list">
              {makes.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Model</label>
            <input
              value={searchModel}
              onChange={e => setSearchModel(e.target.value)}
              placeholder="e.g. 911, Corvette"
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Year</label>
            <input
              value={searchYear}
              onChange={e => setSearchYear(e.target.value)}
              placeholder="e.g. 1972"
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Auction Reference</label>
            <select
              value={searchRef}
              onChange={e => setSearchRef(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">All events</option>
              {auctionRefs.map(ref => (
                <option key={ref} value={ref}>{ref}</option>
              ))}
            </select>
          </div>
        </div>
        {(searchMake || searchModel || searchYear || searchTitle || searchRef) && (
          <button
            onClick={() => { setSearchMake(''); setSearchModel(''); setSearchYear(''); setSearchTitle(''); setSearchRef(''); }}
            className="mt-3 text-xs text-slate-400 hover:text-white underline"
          >
            Clear filters ({stats.total} of {auctions.length} shown)
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading analytics data...</div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total Auctions" value={stats.total} color="blue" />
            <StatCard label="Sold" value={stats.sold} sub={`${stats.total ? ((stats.sold/stats.total)*100).toFixed(0) : 0}% sell-through`} color="green" />
            <StatCard label="Reserve Not Met" value={stats.rnm} sub={`${stats.total ? ((stats.rnm/stats.total)*100).toFixed(0) : 0}% of total`} color="red" />
            <StatCard label="Avg Estimate" value={stats.avgEstimate ? fmt(Math.round(stats.avgEstimate)) : '—'} sub="48h price" color="purple" />
            <StatCard label="Avg Final Price" value={stats.avgFinal ? fmt(Math.round(stats.avgFinal)) : '—'} sub="sold auctions" color="blue" />
            <StatCard
              label="Avg Variance"
              value={stats.avgVariance != null ? pct(stats.avgVariance) : '—'}
              sub={`${stats.over} over / ${stats.under} under`}
              color={stats.avgVariance != null && stats.avgVariance >= 0 ? 'green' : 'red'}
            />
          </div>

          {/* Section Tabs */}
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1 w-fit">
            {SECTION_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
                  activeSection === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* OVERVIEW TAB */}
          {activeSection === 'overview' && (
            <div className="space-y-6">
              {/* Chart */}
              {barData.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold">
                      {chartView === 'bar' ? 'Estimate vs. Final Price (30 most recent)' : 'Estimate vs. Final Price Correlation'}
                    </h3>
                    <div className="flex gap-1 bg-slate-700 rounded p-1">
                      <button
                        onClick={() => setChartView('bar')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${chartView === 'bar' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                      >
                        Bar
                      </button>
                      <button
                        onClick={() => setChartView('scatter')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${chartView === 'scatter' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                      >
                        Scatter
                      </button>
                    </div>
                  </div>

                  {chartView === 'bar' ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <BarChart data={barData} margin={{ top: 5, right: 20, left: 20, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: '#94a3b8', fontSize: 10 }}
                          angle={-40}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis
                          tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ color: '#94a3b8', paddingTop: '8px' }} />
                        <Bar dataKey="estimate" name="48h Estimate" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="final" name="Final Price" fill="#22c55e" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div>
                      <p className="text-slate-500 text-xs mb-3">
                        Each dot is one auction. Dots above the line sold for more than estimated; dots below sold for less.
                      </p>
                      <ResponsiveContainer width="100%" height={360}>
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            type="number"
                            dataKey="x"
                            name="Estimate"
                            tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            label={{ value: '48h Estimate', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
                          />
                          <YAxis
                            type="number"
                            dataKey="y"
                            name="Final"
                            tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            label={{ value: 'Final Price', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                          />
                          <Tooltip content={<ScatterTooltip />} />
                          <ReferenceLine
                            segment={[
                              { x: 0, y: 0 },
                              { x: Math.max(...scatterData.map(d => d.x), 1), y: Math.max(...scatterData.map(d => d.x), 1) }
                            ]}
                            stroke="#64748b"
                            strokeDasharray="4 4"
                            label={{ value: 'Perfect estimate', position: 'insideTopLeft', fill: '#64748b', fontSize: 10 }}
                          />
                          <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.7} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* Auction Table */}
              <div className="bg-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="text-white font-semibold">{sorted.length} Auction{sorted.length !== 1 ? 's' : ''}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900">
                      <tr>
                        <ThBtn field="year">Year</ThBtn>
                        <ThBtn field="make">Make</ThBtn>
                        <ThBtn field="model">Model</ThBtn>
                        <ThBtn field="auction_reference">Auction Ref</ThBtn>
                        <ThBtn field="estimate">48h Estimate</ThBtn>
                        <ThBtn field="final">Final Price</ThBtn>
                        <ThBtn field="variance">Variance</ThBtn>
                        <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wide">Status</th>
                        <ThBtn field="timestamp_end">Ended</ThBtn>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {sorted.map(row => (
                        <tr key={row.auction_id} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-3 py-2.5 text-slate-300">{row.year || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-300">{row.make || '—'}</td>
                          <td className="px-3 py-2.5 text-white font-medium max-w-[200px]">
                            {row.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:text-blue-400 transition-colors group"
                                title={row.title}
                              >
                                <span className="block truncate">{row.model || row.title || '—'}</span>
                                <ExternalLink size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity" />
                              </a>
                            ) : (
                              <span className="block truncate" title={row.title}>{row.model || row.title || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-orange-400 text-xs font-mono">
                            {row.auction_reference || <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-blue-400 font-mono">{fmt(row.estimate)}</td>
                          <td className="px-3 py-2.5 text-green-400 font-mono">{row.final > 0 ? fmt(row.final) : '—'}</td>
                          <td className="px-3 py-2.5 font-mono">
                            {row.variance != null ? (
                              <span className={`flex items-center gap-1 ${row.variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {row.variance >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {pct(row.variance)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {row.reserve_not_met ? (
                              <span className="bg-yellow-900/50 text-yellow-400 text-xs px-2 py-0.5 rounded-full border border-yellow-700">RNM</span>
                            ) : row.final === 0 ? (
                              <span className="bg-slate-700 text-slate-400 text-xs px-2 py-0.5 rounded-full">Withdrawn</span>
                            ) : (
                              <span className="bg-green-900/50 text-green-400 text-xs px-2 py-0.5 rounded-full border border-green-700">Sold</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 text-xs">
                            {row.timestamp_end ? new Date(row.timestamp_end * 1000).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                      {sorted.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                            No completed auctions found matching your filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* BY MANUFACTURER TAB */}
          {activeSection === 'byMake' && (
            <div className="space-y-6">
              {/* Make sell-through bar chart */}
              {topMakeBarData.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4">
                  <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <Car size={16} className="text-blue-400" />
                    Top Manufacturers — Sell-Through Rate
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={topMakeBarData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="make"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        angle={-30}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={v => `${v}%`}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                      />
                      <Tooltip content={<MakeTooltip />} />
                      <Bar dataKey="sellThrough" name="Sell-Through %" radius={[2, 2, 0, 0]}>
                        {topMakeBarData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={entry.sellThrough >= 80 ? '#22c55e' : entry.sellThrough >= 60 ? '#3b82f6' : '#f59e0b'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Make avg variance bar chart */}
              {topMakeBarData.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4">
                  <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                    <Percent size={16} className="text-yellow-400" />
                    Average Variance vs. 48h Estimate by Manufacturer
                  </h3>
                  <p className="text-slate-500 text-xs mb-4">Positive = sold above estimate. Manufacturers with ≥2 auctions shown.</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={topMakeBarData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="make"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        angle={-30}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis
                        tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                      />
                      <Tooltip content={<MakeTooltip />} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Bar dataKey="avgVariance" name="Avg Variance %" radius={[2, 2, 0, 0]}>
                        {topMakeBarData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.avgVariance >= 0 ? '#22c55e' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Make stats table */}
              <div className="bg-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700">
                  <h3 className="text-white font-semibold">{sortedMakeStats.length} Manufacturer{sortedMakeStats.length !== 1 ? 's' : ''}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900">
                      <tr>
                        <MakeThBtn field="make">Make</MakeThBtn>
                        <MakeThBtn field="count">Auctions</MakeThBtn>
                        <MakeThBtn field="soldCount">Sold</MakeThBtn>
                        <MakeThBtn field="sellThrough">Sell-Through</MakeThBtn>
                        <MakeThBtn field="avgVariance">Avg Variance</MakeThBtn>
                        <MakeThBtn field="medianVariance">Median Variance</MakeThBtn>
                        <MakeThBtn field="avgFinal">Avg Final</MakeThBtn>
                        <MakeThBtn field="medianFinal">Median Final</MakeThBtn>
                        <MakeThBtn field="maxFinal">Record Sale</MakeThBtn>
                        <MakeThBtn field="totalVolume">Total Volume</MakeThBtn>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {sortedMakeStats.map(m => (
                        <tr key={m.make} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-3 py-2.5 text-white font-medium">{m.make}</td>
                          <td className="px-3 py-2.5 text-slate-300">{m.count}</td>
                          <td className="px-3 py-2.5 text-green-400">{m.soldCount}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${m.sellThrough >= 80 ? 'bg-green-500' : m.sellThrough >= 60 ? 'bg-blue-500' : 'bg-yellow-500'}`}
                                  style={{ width: `${m.sellThrough}%` }}
                                />
                              </div>
                              <span className="text-slate-300 text-xs">{m.sellThrough.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {m.avgVariance != null ? (
                              <span className={m.avgVariance >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {pct(m.avgVariance)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {m.medianVariance != null ? (
                              <span className={m.medianVariance >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {pct(m.medianVariance)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-blue-400 font-mono">{m.avgFinal ? fmt(Math.round(m.avgFinal)) : '—'}</td>
                          <td className="px-3 py-2.5 text-blue-400 font-mono">{m.medianFinal ? fmt(Math.round(m.medianFinal)) : '—'}</td>
                          <td className="px-3 py-2.5 text-purple-400 font-mono">{m.maxFinal ? fmt(m.maxFinal) : '—'}</td>
                          <td className="px-3 py-2.5 text-slate-300 font-mono">{m.totalVolume > 0 ? fmt(Math.round(m.totalVolume)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* FINANCIAL ANALYSIS TAB */}
          {activeSection === 'financial' && (
            <div className="space-y-6">
              {/* Key financial metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Median Final Price"
                  value={financialStats.medianFinal ? fmt(Math.round(financialStats.medianFinal)) : '—'}
                  sub="50th percentile (sold)"
                  color="blue"
                />
                <StatCard
                  label="P75 Final Price"
                  value={financialStats.p75Final ? fmt(Math.round(financialStats.p75Final)) : '—'}
                  sub="75th percentile (sold)"
                  color="purple"
                />
                <StatCard
                  label="P90 Final Price"
                  value={financialStats.p90Final ? fmt(Math.round(financialStats.p90Final)) : '—'}
                  sub="90th percentile (sold)"
                  color="yellow"
                />
                <StatCard
                  label="Total Volume"
                  value={financialStats.totalVolume > 0 ? `$${(financialStats.totalVolume / 1_000_000).toFixed(1)}M` : '—'}
                  sub="sum of all sold prices"
                  color="green"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Median Estimate"
                  value={financialStats.medianEstimate ? fmt(Math.round(financialStats.medianEstimate)) : '—'}
                  sub="48h baseline median"
                  color="blue"
                />
                <StatCard
                  label="Median Variance"
                  value={financialStats.medianVariance != null ? pct(financialStats.medianVariance) : '—'}
                  sub="typical over/under"
                  color={financialStats.medianVariance != null && financialStats.medianVariance >= 0 ? 'green' : 'red'}
                />
                <StatCard
                  label="Avg Price Multiple"
                  value={financialStats.avgMultiple != null ? `${financialStats.avgMultiple.toFixed(2)}×` : '—'}
                  sub="final ÷ estimate"
                  color="purple"
                />
                <StatCard
                  label="Median vs Avg Gap"
                  value={
                    financialStats.medianFinal && stats.avgFinal
                      ? fmt(Math.round(stats.avgFinal - financialStats.medianFinal))
                      : '—'
                  }
                  sub="avg pulled up by outliers"
                  color="yellow"
                />
              </div>

              {/* Price distribution */}
              <div className="bg-slate-800 rounded-lg p-4">
                <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                  <DollarSign size={16} className="text-green-400" />
                  Final Price Distribution (Sold Auctions)
                </h3>
                <p className="text-slate-500 text-xs mb-4">How many lots fall into each price bracket.</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={financialStats.brackets}
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 6 }}
                      labelStyle={{ color: '#fff' }}
                      itemStyle={{ color: '#22c55e' }}
                    />
                    <Bar dataKey="sold" name="Lots Sold" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Top over/under performers */}
              <div className="grid md:grid-cols-2 gap-4">
                {/* Top overperformers */}
                <div className="bg-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
                    <TrendingUp size={16} className="text-green-400" />
                    <h3 className="text-white font-semibold">Top Overperformers</h3>
                    <span className="text-slate-500 text-xs ml-auto">Highest variance vs. estimate</span>
                  </div>
                  <div className="divide-y divide-slate-700/50">
                    {financialStats.topOver.map((row, i) => (
                      <div key={row.auction_id} className="px-4 py-3 flex items-start gap-3">
                        <div className="text-slate-600 text-xs font-mono w-4 pt-0.5">#{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-white hover:text-blue-400 transition-colors font-medium flex items-center gap-1 group"
                            >
                              <span className="truncate">{row.title}</span>
                              <ExternalLink size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-blue-400" />
                            </a>
                          ) : (
                            <div className="text-sm text-white font-medium truncate">{row.title}</div>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5">
                            {fmt(row.estimate)} → {fmt(row.final)}
                          </div>
                        </div>
                        <div className="text-green-400 font-mono text-sm font-semibold flex-shrink-0">
                          {pct(row.variance)}
                        </div>
                      </div>
                    ))}
                    {financialStats.topOver.length === 0 && (
                      <div className="px-4 py-6 text-center text-slate-500 text-sm">No data</div>
                    )}
                  </div>
                </div>

                {/* Top underperformers */}
                <div className="bg-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
                    <TrendingDown size={16} className="text-red-400" />
                    <h3 className="text-white font-semibold">Top Underperformers</h3>
                    <span className="text-slate-500 text-xs ml-auto">Lowest variance vs. estimate</span>
                  </div>
                  <div className="divide-y divide-slate-700/50">
                    {financialStats.topUnder.map((row, i) => (
                      <div key={row.auction_id} className="px-4 py-3 flex items-start gap-3">
                        <div className="text-slate-600 text-xs font-mono w-4 pt-0.5">#{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-white hover:text-blue-400 transition-colors font-medium flex items-center gap-1 group"
                            >
                              <span className="truncate">{row.title}</span>
                              <ExternalLink size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-blue-400" />
                            </a>
                          ) : (
                            <div className="text-sm text-white font-medium truncate">{row.title}</div>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5">
                            {fmt(row.estimate)} → {fmt(row.final)}
                          </div>
                        </div>
                        <div className="text-red-400 font-mono text-sm font-semibold flex-shrink-0">
                          {pct(row.variance)}
                        </div>
                      </div>
                    ))}
                    {financialStats.topUnder.length === 0 && (
                      <div className="px-4 py-6 text-center text-slate-500 text-sm">No data</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sell-through by price bracket */}
              <div className="bg-slate-800 rounded-lg p-4">
                <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                  <Award size={16} className="text-yellow-400" />
                  Sell-Through Rate by Price Bracket
                </h3>
                <p className="text-slate-500 text-xs mb-4">Do higher-priced cars sell more or less reliably?</p>
                <div className="space-y-2">
                  {financialStats.brackets.map(b => {
                    const rate = b.total > 0 ? (b.sold / b.total) * 100 : null;
                    return (
                      <div key={b.label} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-slate-400 text-right flex-shrink-0">{b.label}</div>
                        <div className="flex-1 bg-slate-700 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              rate == null ? 'bg-slate-600' :
                              rate >= 80 ? 'bg-green-500' :
                              rate >= 60 ? 'bg-blue-500' : 'bg-yellow-500'
                            }`}
                            style={{ width: rate != null ? `${rate}%` : '0%' }}
                          />
                        </div>
                        <div className="w-20 text-xs text-slate-300 flex-shrink-0">
                          {rate != null ? `${rate.toFixed(0)}%` : '—'} ({b.sold}/{b.total})
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
