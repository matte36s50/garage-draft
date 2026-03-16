'use client'
import React, { useState, useEffect, useMemo } from 'react';
import { Search, TrendingUp, TrendingDown, DollarSign, BarChart2, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine
} from 'recharts';

const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString()}`;
const pct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

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
      <div className="text-slate-300">{d.year} {d.make} {d.model}</div>
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
      <div className="text-slate-300">{d.year} {d.make} {d.model}</div>
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

  const loadData = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase
        .from('auctions')
        .select('auction_id, title, make, model, year, price_at_48h, final_price, current_bid, reserve_not_met, timestamp_end, inserted_at, auction_reference')
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

  // Derive unique makes for datalist
  const makes = useMemo(() => [...new Set(auctions.map(a => a.make).filter(Boolean))].sort(), [auctions]);

  // Filtered auctions
  const filtered = useMemo(() => {
    return auctions.filter(a => {
      if (searchMake && !a.make?.toLowerCase().includes(searchMake.toLowerCase())) return false;
      if (searchModel && !a.model?.toLowerCase().includes(searchModel.toLowerCase())) return false;
      if (searchYear && String(a.year) !== searchYear) return false;
      if (searchTitle && !a.title?.toLowerCase().includes(searchTitle.toLowerCase())) return false;
      if (searchRef && !a.auction_reference?.toLowerCase().includes(searchRef.toLowerCase()) && !a.auction_id?.toLowerCase().includes(searchRef.toLowerCase())) return false;
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

  // Bar chart data - top 30 by variance magnitude
  const barData = useMemo(() => {
    return rows
      .filter(r => r.estimate && r.final && r.final > 0)
      .sort((a, b) => (b.timestamp_end || 0) - (a.timestamp_end || 0))
      .slice(0, 30)
      .map(r => ({
        name: `${r.year} ${r.make} ${r.model}`.slice(0, 22),
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

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronUp size={12} className="text-slate-600" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-400" /> : <ChevronDown size={12} className="text-blue-400" />;
  };

  const ThBtn = ({ field, children }) => (
    <th
      className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white select-none"
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">{children}<SortIcon field={field} /></span>
    </th>
  );

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
        <div className="flex items-center gap-3">
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
            onClick={loadData}
            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

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
              list="title-list"
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
            <label className="text-xs text-slate-500 mb-1 block">Auction Reference / ID</label>
            <input
              value={searchRef}
              onChange={e => setSearchRef(e.target.value)}
              placeholder="e.g. bat-12345"
              className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
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

      {/* Stats Cards */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading analytics data...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total Auctions" value={stats.total} color="blue" />
            <StatCard label="Sold" value={stats.sold} sub={`${stats.total ? ((stats.sold/stats.total)*100).toFixed(0) : 0}% of total`} color="green" />
            <StatCard label="Reserve Not Met" value={stats.rnm} sub={`${stats.total ? ((stats.rnm/stats.total)*100).toFixed(0) : 0}% of total`} color="red" />
            <StatCard label="Avg Estimate" value={stats.avgEstimate ? fmt(Math.round(stats.avgEstimate)) : '—'} sub="48h price" color="purple" />
            <StatCard label="Avg Final Price" value={stats.avgFinal ? fmt(Math.round(stats.avgFinal)) : '—'} sub="sold auctions" color="blue" />
            <StatCard
              label="Avg Variance"
              value={stats.avgVariance != null ? pct(stats.avgVariance) : '—'}
              sub={`${stats.over} over / ${stats.under} under`}
              color={stats.avgVariance >= 0 ? 'green' : 'red'}
            />
          </div>

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
                      {/* y = x reference line */}
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

          {/* Table */}
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
                      <td className="px-3 py-2.5 text-white font-medium max-w-[160px]">
                        <span className="block truncate" title={row.title}>{row.model || row.title || '—'}</span>
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
        </>
      )}
    </div>
  );
}
