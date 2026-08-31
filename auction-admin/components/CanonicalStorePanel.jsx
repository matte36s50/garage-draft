'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw, Download, Search, Plus, CheckCircle, XCircle, ExternalLink,
  Gavel, ListChecks, Rows3, FolderTree, Radio, Sparkles, Pencil, Trash2, LineChart, Eye, Activity,
} from 'lucide-react';
import {
  DEFAULT_CATEGORY, FEE_CATEGORY_LABELS, categoryLabel, computePremium,
  describeTierSet, normalizeFeeSchedule,
} from '../lib/feeSchedule';
import { api } from '../lib/adminApi';
import BucketComparables from './BucketComparables';
import LiveSales from './LiveSales';
import ReconcilePanel from './ReconcilePanel';
import DemandSignals from './DemandSignals';
import MarketPulse from './MarketPulse';

/**
 * Unified admin panel for the canonical auction store (plan §5, Phase 3 MVP).
 * Tabs: Live Board · Results · Live Entry · Review Queue · Buckets.
 * All data flows through /api/store/* server routes (service key stays
 * server-side); this component never talks to Supabase directly.
 */

const fmtMoney = (v, cur = 'USD') =>
  v == null ? '—' : `${cur === 'USD' ? '$' : `${cur} `}${Number(v).toLocaleString()}`;
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');
const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString());
const OUTCOME_BADGE = {
  sold: 'bg-emerald-900/40 text-emerald-300',
  reserve_not_met: 'bg-amber-900/40 text-amber-300',
  withdrawn: 'bg-red-900/40 text-red-300',
  unknown: 'bg-slate-700 text-slate-300',
};

// Human-readable label for a live-auction event (house + sale name), de-duped
// so "RM Sotheby's" + "RM Sotheby's Amelia Island" doesn't repeat the house.
function eventLabel(ev) {
  if (!ev) return null;
  const house = (ev.house || '').trim();
  const name = (ev.name || '').trim();
  if (house && name) {
    if (name.toLowerCase() === house.toLowerCase()) return name;
    if (name.toLowerCase().startsWith(house.toLowerCase())) return name;
    return `${house} ${name}`;
  }
  return name || house || null;
}

// The Source cell: for manual/live rows show the auction event's name; for
// scraped sources (bat, carsandbids) show the source id as before.
function SourceCell({ row, eventsById }) {
  const ev = row.event_id ? eventsById[row.event_id] : null;
  const label = row.source_id === 'manual'
    ? (eventLabel(ev) || eventLabel({ house: row.raw_payload?.event_house, name: row.raw_payload?.event_name }))
    : null;
  if (label) {
    return <Badge className="bg-indigo-900/40 text-indigo-200" title={`Manual / live · ${label}`}>{label}</Badge>;
  }
  return <Badge>{row.source_id}</Badge>;
}

// Fetch the live-auction events once and return an { event_id: event } map, so
// any tab can resolve a manual listing's event name for its Source cell.
function useEventsById() {
  const [eventsById, setEventsById] = useState({});
  useEffect(() => {
    api('/api/store/events')
      .then((d) => setEventsById(Object.fromEntries((d.rows || []).map((e) => [e.id, e]))))
      .catch(() => {});
  }, []);
  return eventsById;
}

// Shared with the other admin panels — see lib/adminApi.js.

function Badge({ children, className = 'bg-slate-700 text-slate-300' }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>;
}

function Th({ children }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 text-sm text-slate-200 ${className}`}>{children}</td>;
}
const inputCls = 'p-2 rounded bg-slate-700 text-white border border-slate-600 focus:border-blue-400 outline-none text-sm';

// ---------------------------------------------------------------- Live board
function LiveBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState(null);
  const [error, setError] = useState(null);
  const eventsById = useEventsById();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api('/api/store/listings?status=upcoming,live&sort=ends_at&dir=asc&limit=200');
      setRows(data.rows);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const syncFromGame = async () => {
    setSyncing(true); setError(null); setSyncNote(null);
    try {
      const data = await api('/api/store/sync-live', { method: 'POST' });
      setSyncNote(data.synced > 0 ? `${data.synced} live listing(s) synced from the game` : (data.message || 'Nothing to sync'));
      await load();
    } catch (e) { setError(e.message); }
    setSyncing(false);
  };

  return (
    <div>
      <ReconcilePanel />
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-400 text-sm">
          Upcoming + live listings across all sources, soonest ending first.
          {' '}Live game auctions only appear after a sync — use “Sync from game” or schedule <code>/api/store/sync-live</code>.
        </p>
        <div className="flex items-center gap-2">
          {syncNote && <span className="text-emerald-400 text-sm">{syncNote}</span>}
          <button onClick={syncFromGame} disabled={syncing}
            className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50">
            <Radio size={14} /> {syncing ? 'Syncing…' : 'Sync from game'}
          </button>
          <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr><Th>Ends</Th><Th>Title</Th><Th>Source</Th><Th>Current bid</Th><Th>Bids</Th><Th>Watchers</Th><Th>Comments</Th><Th>Status</Th><Th>Link</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-700/40">
                <Td className="whitespace-nowrap">{r.ends_at ? new Date(r.ends_at).toLocaleString() : '—'}</Td>
                <Td>{r.raw_title || `${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`}</Td>
                <Td><SourceCell row={r} eventsById={eventsById} /></Td>
                <Td>{fmtMoney(r.current_bid, r.currency)}</Td>
                <Td>{fmtNum(r.bid_count)}</Td>
                <Td>{fmtNum(r.watchers)}</Td>
                <Td>{fmtNum(r.comments)}</Td>
                <Td><Badge className={r.status === 'live' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-sky-900/40 text-sky-300'}>{r.status}</Badge></Td>
                <Td>{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300"><ExternalLink size={14} /></a>}</Td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={9}>No live or upcoming listings in the store yet — try “Sync from game”.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Results
function Results() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', source: '', outcome: '', from: '', to: '', needs_review: false });
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Live-auction events, so manual rows can show their sale name in Source.
  const eventsById = useEventsById();

  // Buckets, so a mis-bucketed listing can be moved from the row editor.
  const [buckets, setBuckets] = useState([]);
  useEffect(() => {
    api('/api/store/buckets').then((d) => setBuckets(d.rows || [])).catch(() => {});
  }, []);

  // Inline listing editor (manual correction of outcome / price / review flag).
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [bucketSel, setBucketSel] = useState('');
  const [movingBucket, setMovingBucket] = useState(false);

  const openEditor = (r) => {
    setEditError(null);
    setEditingId(r.id);
    setEdit({
      outcome: r.outcome || 'unknown',
      // Seed the amount field from whichever the row already carries.
      amount: r.price != null ? String(r.price) : (r.current_bid != null ? String(r.current_bid) : ''),
      needs_review: Boolean(r.needs_review),
    });
    setBucketSel(r.canonical_model_id || '');
  };
  const closeEditor = () => { setEditingId(null); setEdit({}); setEditError(null); };

  const bucketLabel = (id) => {
    const b = buckets.find((x) => x.id === id);
    return b ? `${b.make} ${b.model}${b.generation ? ` (${b.generation})` : ''}` : 'none';
  };

  // Immediate action, separate from "Save correction": move the listing to
  // another bucket, or back to the review queue ('' = none).
  const moveBucket = async (r) => {
    setMovingBucket(true); setEditError(null);
    try {
      await api('/api/store/reassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: r.id, canonical_model_id: bucketSel || null }),
      });
      closeEditor();
      await load();
    } catch (e) { setEditError(e.message); }
    setMovingBucket(false);
  };

  const saveEdit = async (r) => {
    setSavingEdit(true); setEditError(null);
    try {
      const body = {
        source_id: r.source_id,
        source_listing_id: r.source_listing_id,
        outcome: edit.outcome,
        needs_review: edit.needs_review,
      };
      // The amount means "sale price" for sold, "high bid" otherwise.
      if (edit.outcome === 'sold') body.price = edit.amount;
      else if (edit.outcome === 'reserve_not_met') body.current_bid = edit.amount;
      await api('/api/store/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      closeEditor();
      await load();
    } catch (e) { setEditError(e.message); }
    setSavingEdit(false);
  };

  const load = useCallback(async (f = filters, o = offset) => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ status: 'ended', sort: 'ended_at', dir: 'desc', limit, offset: o });
      if (f.q) p.set('q', f.q);
      if (f.source) p.set('source', f.source);
      if (f.outcome) p.set('outcome', f.outcome);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      if (f.needs_review) p.set('needs_review', 'true');
      const data = await api(`/api/store/listings?${p}`);
      setRows(data.rows); setTotal(data.total ?? data.rows.length);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [filters, offset]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => { setOffset(0); load(filters, 0); };
  const page = (delta) => { const o = Math.max(0, offset + delta); setOffset(o); load(filters, o); };

  const exportCsv = () => {
    const cols = ['source_id','source_listing_id','raw_title','year','make','model','outcome','price','price_all_in','current_bid','currency','bid_count','views','watchers','comments','ended_at','url'];
    const esc = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `auction_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input className={`${inputCls} pl-8 w-56`} placeholder="Title / make / model…" value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
        <select className={inputCls} value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
          <option value="">All sources</option><option value="bat">BaT</option>
          <option value="carsandbids">Cars & Bids</option><option value="manual">Manual / live</option>
        </select>
        <select className={inputCls} value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}>
          <option value="">All outcomes</option><option value="sold">Sold</option>
          <option value="reserve_not_met">Reserve not met</option><option value="withdrawn">Withdrawn</option>
          <option value="unknown">Unknown</option>
        </select>
        <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <span className="text-slate-500 text-sm">→</span>
        <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <label className="flex items-center gap-1.5 text-sm text-slate-300">
          <input type="checkbox" checked={filters.needs_review} onChange={(e) => setFilters({ ...filters, needs_review: e.target.checked })} />
          needs review
        </label>
        <button onClick={apply} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded font-medium">Apply</button>
        <button onClick={exportCsv} disabled={rows.length === 0}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-2 rounded disabled:opacity-50">
          <Download size={14} /> CSV
        </button>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr><Th>Ended</Th><Th>Title</Th><Th>Source</Th><Th>Outcome</Th><Th>Price</Th><Th>All-in</Th><Th>Bids</Th><Th>Views</Th><Th>Watchers</Th><Th>Comments</Th><Th>Link</Th><Th>Edit</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {rows.map((r) => (
              <React.Fragment key={r.id}>
              <tr className="hover:bg-slate-700/40">
                <Td className="whitespace-nowrap">{fmtDate(r.ended_at)}</Td>
                <Td>
                  {r.raw_title || `${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`}
                  {r.needs_review && <Badge className="ml-2 bg-amber-900/40 text-amber-300">review</Badge>}
                </Td>
                <Td><SourceCell row={r} eventsById={eventsById} /></Td>
                <Td><Badge className={OUTCOME_BADGE[r.outcome] || OUTCOME_BADGE.unknown}>{r.outcome || '—'}</Badge></Td>
                <Td>
                  {r.price != null ? fmtMoney(r.price, r.currency)
                    : r.outcome === 'reserve_not_met' && r.current_bid != null
                      ? <span className="text-amber-300/90" title="High bid — reserve not met">
                          {fmtMoney(r.current_bid, r.currency)}<span className="text-xs text-slate-500"> bid</span>
                        </span>
                      : '—'}
                </Td>
                <Td>{fmtMoney(r.price_all_in, r.currency)}</Td>
                <Td>{fmtNum(r.bid_count)}</Td>
                <Td>{fmtNum(r.views)}</Td>
                <Td>{fmtNum(r.watchers)}</Td>
                <Td>{fmtNum(r.comments)}</Td>
                <Td>{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300"><ExternalLink size={14} /></a>}</Td>
                <Td>
                  <button onClick={() => (editingId === r.id ? closeEditor() : openEditor(r))}
                    className="text-slate-400 hover:text-blue-300" title="Correct outcome / price / review flag">
                    <Pencil size={14} />
                  </button>
                </Td>
              </tr>
              {editingId === r.id && (
                <tr className="bg-slate-800/80">
                  <Td className="!p-0" colSpan={12}>
                    <div className="px-4 py-3 border-y border-blue-700/40 bg-slate-900/40">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-400">Outcome</label>
                          <select className={`${inputCls} py-1`} value={edit.outcome}
                            onChange={(e) => setEdit({ ...edit, outcome: e.target.value })}>
                            <option value="sold">Sold</option>
                            <option value="reserve_not_met">Reserve not met (Bid to)</option>
                            <option value="withdrawn">Withdrawn</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </div>
                        {(edit.outcome === 'sold' || edit.outcome === 'reserve_not_met') && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400">
                              {edit.outcome === 'sold' ? 'Sale price $' : 'High bid $ (reserve not met)'}
                            </label>
                            <input className={`${inputCls} py-1 w-36`} inputMode="numeric"
                              placeholder={edit.outcome === 'sold' ? 'Price' : 'High bid'}
                              value={edit.amount}
                              onChange={(e) => setEdit({ ...edit, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                          </div>
                        )}
                        <label className="flex items-center gap-1.5 text-sm text-slate-300 pb-1.5">
                          <input type="checkbox" checked={edit.needs_review}
                            onChange={(e) => setEdit({ ...edit, needs_review: e.target.checked })} />
                          needs review
                        </label>
                        <button onClick={() => saveEdit(r)} disabled={savingEdit}
                          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                          <CheckCircle size={14} /> {savingEdit ? 'Saving…' : 'Save correction'}
                        </button>
                        <button onClick={closeEditor} className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1.5">Cancel</button>
                      </div>
                      <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-slate-700/60">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-400">
                            Bucket <span className="text-slate-500">(currently: {bucketLabel(r.canonical_model_id)})</span>
                          </label>
                          <select className={`${inputCls} py-1 max-w-xs`} value={bucketSel}
                            onChange={(e) => setBucketSel(e.target.value)}>
                            <option value="">— none (back to review queue) —</option>
                            {buckets.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.make} {b.model}{b.generation ? ` (${b.generation})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button onClick={() => moveBucket(r)}
                          disabled={movingBucket || bucketSel === (r.canonical_model_id || '')}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                          {movingBucket ? 'Moving…' : 'Move'}
                        </button>
                        <span className="text-slate-500 text-xs pb-1.5">
                          Moves only this listing — e.g. a 190E Evo II out of the plain 190E bucket. Alias operations
                          never override a manual move.
                        </span>
                      </div>
                      {editError && <p className="text-red-300 text-sm mt-2">{editError}</p>}
                      <p className="text-slate-500 text-xs mt-2">
                        Manual corrections are protected — future scraper runs won’t overwrite the fields you change here.
                      </p>
                    </div>
                  </Td>
                </tr>
              )}
              </React.Fragment>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={12}>No results match.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-3 text-sm text-slate-400">
        <button onClick={() => page(-limit)} disabled={offset === 0} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">← Prev</button>
        <span>{offset + 1}–{offset + rows.length} of {total.toLocaleString()}</span>
        <button onClick={() => page(limit)} disabled={offset + limit >= total} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">Next →</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------- Buyer premium tiers
// Houses publish a fee table, not a single rate ("12% up to $250,000, 10% on
// any balance over; motorcycles 20%"). The editor below keeps tiers as typed
// strings and normalizes through lib/feeSchedule, so the preview here and the
// premium the server writes come from the same arithmetic.

const emptyFeeRow = (category = DEFAULT_CATEGORY) => ({
  category, mode: 'marginal', tiers: [{ up_to: '', pct: '' }],
});

/** Editor rows -> canonical schedule (throws with a readable reason). */
function feeRowsToSchedule(rows) {
  const categories = {};
  for (const r of rows) {
    if (categories[r.category]) {
      throw new Error(`Two fee rows both cover ${categoryLabel(r.category)} — merge them or pick another category`);
    }
    categories[r.category] = { mode: r.mode, tiers: r.tiers };
  }
  return normalizeFeeSchedule({ categories });
}

/** Canonical schedule -> editor rows. */
function scheduleToFeeRows(schedule) {
  if (!schedule?.categories || !Object.keys(schedule.categories).length) return [emptyFeeRow()];
  return Object.entries(schedule.categories).map(([category, set]) => ({
    category,
    mode: set.mode,
    tiers: set.tiers.map((t) => ({ up_to: t.up_to == null ? '' : String(t.up_to), pct: String(t.pct) })),
  }));
}

// Schedules are remembered per event in the browser, so re-opening an event
// mid-sale brings its fee table back without retyping. The authoritative copy
// travels with each lot (raw_payload.fee_schedule) and is reloaded from there
// by "Load event lots" when this browser has never seen the event.
const feeStorageKey = (eventName) => `store-fee-schedule:${String(eventName || '').trim().toLowerCase()}`;

function loadStoredFeeRows(eventName) {
  if (typeof window === 'undefined' || !eventName?.trim()) return null;
  try {
    const raw = window.localStorage.getItem(feeStorageKey(eventName));
    return raw ? scheduleToFeeRows(normalizeFeeSchedule(JSON.parse(raw))) : null;
  } catch { return null; }
}

function FeeScheduleEditor({ rows, setRows, schedule, error, currency }) {
  const [sample, setSample] = useState('');
  const cur = currency || 'USD';
  const unusedCategory = Object.keys(FEE_CATEGORY_LABELS)
    .find((k) => !rows.some((r) => r.category === k)) || `category_${rows.length + 1}`;

  const patchRow = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const patchTier = (i, ti, patch) => patchRow(i, {
    tiers: rows[i].tiers.map((t, idx) => (idx === ti ? { ...t, ...patch } : t)),
  });

  return (
    <div className="mt-3 border-t border-slate-700 pt-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-slate-300 text-sm font-semibold uppercase tracking-wide">Buyer premium</h4>
        <span className="text-slate-500 text-xs">
          Sliding scales welcome — a blank threshold means “and anything above”.
        </span>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 mt-2">
          <select className={`${inputCls} py-1`} value={row.category}
            onChange={(e) => patchRow(i, { category: e.target.value })}>
            {Object.entries(FEE_CATEGORY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            {!FEE_CATEGORY_LABELS[row.category] && <option value={row.category}>{row.category}</option>}
          </select>
          <select className={`${inputCls} py-1`} value={row.mode} title="How the bands combine"
            onChange={(e) => patchRow(i, { mode: e.target.value })}>
            <option value="marginal">tier by band (12% up to X, 10% on the balance)</option>
            <option value="bracket">whole price at one band’s rate</option>
          </select>
          {row.tiers.map((t, ti) => (
            <span key={ti} className="flex items-center gap-1 bg-slate-900/40 rounded px-2 py-1">
              <input className={`${inputCls} w-16 py-1`} placeholder="%" inputMode="decimal" value={t.pct}
                onChange={(e) => patchTier(i, ti, { pct: e.target.value.replace(/[^\d.]/g, '') })} />
              <span className="text-slate-500 text-xs">% up to</span>
              <input className={`${inputCls} w-28 py-1`} placeholder="no limit" inputMode="numeric" value={t.up_to}
                onChange={(e) => patchTier(i, ti, { up_to: e.target.value.replace(/[^\d.]/g, '') })} />
              {row.tiers.length > 1 && (
                <button type="button" title="Remove tier" className="text-slate-500 hover:text-red-300"
                  onClick={() => patchRow(i, { tiers: row.tiers.filter((_, idx) => idx !== ti) })}>
                  <XCircle size={13} />
                </button>
              )}
            </span>
          ))}
          <button type="button" className="text-blue-300 hover:text-blue-200 text-xs px-1"
            onClick={() => patchRow(i, { tiers: [...row.tiers, { up_to: '', pct: '' }] })}>
            + tier
          </button>
          {rows.length > 1 && (
            <button type="button" title="Remove category" className="text-slate-500 hover:text-red-300"
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button type="button" className="text-blue-300 hover:text-blue-200 text-xs"
          onClick={() => setRows([...rows, emptyFeeRow(unusedCategory)])}>
          + lot category
        </button>
        <button type="button" className="text-slate-500 hover:text-slate-300 text-xs"
          onClick={() => setRows([emptyFeeRow()])}>
          clear
        </button>
        <input className={`${inputCls} w-36 py-1`} placeholder="Preview hammer $" inputMode="numeric"
          value={sample} onChange={(e) => setSample(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>

      {error && <p className="text-red-300 text-xs mt-2">{error}</p>}
      {!error && schedule && (
        <div className="mt-2 space-y-0.5">
          {Object.entries(schedule.categories).map(([key, set]) => {
            const fee = sample ? computePremium(sample, schedule, key) : null;
            return (
              <p key={key} className="text-slate-400 text-xs">
                <span className="text-slate-300">{categoryLabel(key)}</span> — {describeTierSet(set)}
                {fee && (
                  <span className="text-emerald-300">
                    {' · '}{fmtMoney(Number(sample), cur)} hammer → premium {fmtMoney(fee.premium, cur)}
                    {' '}({fee.effective_pct}%) → all-in {fmtMoney(fee.price_all_in, cur)}
                  </span>
                )}
              </p>
            );
          })}
        </div>
      )}
      {!error && !schedule && (
        <p className="text-slate-500 text-xs mt-2">No premium set — lots save with hammer prices only.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Live entry
function LiveEntry() {
  const [event, setEvent] = useState({ event_name: '', event_house: '', event_location: '', sale_date: '', currency: '' });
  const [feeRows, setFeeRows] = useState([emptyFeeRow()]);
  const [lotCategory, setLotCategory] = useState(DEFAULT_CATEGORY);
  const [events, setEvents] = useState([]);
  const [mode, setMode] = useState('estimate'); // 'estimate' (pre-auction) | 'result'
  const [lot, setLot] = useState({ lot: '', year: '', make: '', model: '', trim: '', price: '', estimate_low: '', estimate_high: '', outcome: 'sold' });
  const [entered, setEntered] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef(null);

  // Event lots (the "go back and update with results" pass)
  const [eventLots, setEventLots] = useState(null);
  const [lotEdits, setLotEdits] = useState({});
  const [savingLot, setSavingLot] = useState(null);

  // AI import
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [staged, setStaged] = useState(null);
  const [aiNote, setAiNote] = useState(null); // "read 6 of 9 slices" — a partial extraction
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  useEffect(() => {
    api('/api/store/events').then((d) => setEvents(d.rows || [])).catch(() => {});
  }, []);

  // The fee table the editor currently describes; null when nothing is set.
  const { schedule: feeSchedule, error: feeError } = useMemo(() => {
    try { return { schedule: feeRowsToSchedule(feeRows), error: null }; }
    catch (e) { return { schedule: null, error: e.message }; }
  }, [feeRows]);
  const feeCategories = feeSchedule ? Object.keys(feeSchedule.categories) : [];

  // Keep the picked category on a row that still exists in the schedule.
  useEffect(() => {
    if (feeCategories.length && !feeCategories.includes(lotCategory)) {
      setLotCategory(feeCategories.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : feeCategories[0]);
    }
  }, [feeCategories.join(','), lotCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore a remembered schedule when an event name is typed/picked — but
  // never over tiers already entered for the event in front of you.
  const feeRowsRef = useRef(feeRows);
  feeRowsRef.current = feeRows;
  useEffect(() => {
    if (!event.event_name?.trim()) return;
    let hasTiers = true;
    try { hasTiers = Boolean(feeRowsToSchedule(feeRowsRef.current)); } catch { hasTiers = true; }
    if (hasTiers) return;
    const stored = loadStoredFeeRows(event.event_name);
    if (stored) setFeeRows(stored);
  }, [event.event_name]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = event.event_name?.trim();
    if (!name || !feeSchedule) return;
    try { window.localStorage.setItem(feeStorageKey(name), JSON.stringify(feeSchedule)); } catch { /* private mode */ }
  }, [event.event_name, feeSchedule]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (feeError) { setError(feeError); return; }
    setError(null); setSaving(true);
    try {
      const body = { ...event, ...lot, mode };
      if (feeSchedule) {
        body.fee_schedule = feeSchedule;
        body.lot_category = lotCategory;
      }
      const data = await api('/api/store/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setEntered((prev) => [{ ...body, id: data.source_listing_id, all_in: data.payload.price_all_in }, ...prev]);
      setLot({ lot: lot.lot ? String(Number(lot.lot) + 1 || '') : '', year: '', make: '', model: '', trim: '', price: '', estimate_low: '', estimate_high: '', outcome: 'sold' });
      firstFieldRef.current?.focus();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const loadEventLots = async () => {
    if (!event.event_name) { setError('Enter an event name first'); return; }
    setError(null);
    try {
      const data = await api(`/api/store/entry?event=${encodeURIComponent(event.event_name)}`);
      setEventLots(data.rows);
      if (data.event) {
        setEvent((ev) => ({ ...ev, event_house: ev.event_house || data.event.house || '', event_location: ev.event_location || data.event.location || '' }));
      }
      // Lots carry the schedule they were priced with — adopt it when this
      // browser has no tiers for the event yet.
      if (data.fee_schedule && !feeSchedule) setFeeRows(scheduleToFeeRows(data.fee_schedule));
    } catch (e) { setError(e.message); }
  };

  const saveLotResult = async (row) => {
    const edit = lotEdits[row.id] || {};
    if (feeError) { setError(feeError); return; }
    setSavingLot(row.id); setError(null);
    try {
      await api('/api/store/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'result',
          source_listing_id: row.source_listing_id,
          make: row.make, model: row.model, trim: row.trim, year: row.year,
          event_name: event.event_name,
          outcome: edit.outcome || 'sold',
          price: edit.price,
          currency: event.currency || undefined,
          sale_date: event.sale_date || undefined,
          fee_schedule: feeSchedule || undefined,
          lot_category: feeSchedule ? (edit.category || lotCategory) : undefined,
        }),
      });
      await loadEventLots();
    } catch (e) { setError(e.message); }
    setSavingLot(null);
  };

  const runExtract = async () => {
    setAiBusy(true); setError(null); setStaged(null); setAiNote(null); setImportedCount(0);
    try {
      const isUrl = /^https?:\/\//i.test(aiInput.trim());
      const data = await api('/api/store/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, [isUrl ? 'url' : 'text']: aiInput.trim() }),
      });
      setStaged(data.lots.map((l) => ({ ...l, _include: true })));
      // A long catalog is read in slices; say so when only some of them landed,
      // so a short list is not mistaken for the whole sale.
      if (data.note) setAiNote(data.note);
      if (data.lots.length === 0) {
        setError('No lots found in that input. Many catalog pages load their lots with JavaScript, '
          + 'so the URL fetch sees an empty shell — open the page in your browser, let the lots render, '
          + 'then paste the page HTML (or select-all + copy the visible text) instead.');
      }
      const ev = data.event || {};
      const extractedCurrency = data.lots.find((l) => l.currency && l.currency !== 'USD')?.currency || '';
      setEvent((prev) => ({
        ...prev,
        event_name: prev.event_name || ev.name || '',
        event_house: prev.event_house || ev.house || '',
        event_location: prev.event_location || ev.location || '',
        currency: prev.currency || extractedCurrency,
      }));
      // A fee table on the page (flat or tiered) fills the editor when it is
      // still empty — never over tiers already entered by hand.
      if (ev.fee_schedule && !feeSchedule) setFeeRows(scheduleToFeeRows(ev.fee_schedule));
    } catch (e) { setError(e.message); }
    setAiBusy(false);
  };

  const importStaged = async () => {
    if (!staged) return;
    if (feeError) { setError(feeError); return; }
    setImporting(true); setError(null);
    let ok = 0;
    for (const l of staged) {
      if (!l._include || !l.make || !l.model) continue;
      try {
        await api('/api/store/entry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: l.outcome ? 'result' : mode,
            ...event,
            lot: l.lot, year: l.year, make: l.make, model: l.model, trim: l.trim,
            estimate_low: l.estimate_low, estimate_high: l.estimate_high,
            price: l.price, outcome: l.outcome || undefined,
            currency: l.currency || event.currency || undefined,
            sale_date: event.sale_date || undefined,
            fee_schedule: feeSchedule || undefined,
            lot_category: feeSchedule ? (l.category || lotCategory) : undefined,
          }),
        });
        ok += 1;
        setImportedCount(ok);
      } catch (e) {
        setError(`Import stopped at lot ${l.lot || '?'}: ${e.message}`);
        break;
      }
    }
    setImporting(false);
  };

  const setStagedField = (i, field, value) => {
    setStaged((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  };

  return (
    <div className="max-w-6xl">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 mb-4">
        <h3 className="text-slate-300 text-sm font-semibold mb-2 uppercase tracking-wide">Event</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input className={inputCls} list="store-events" placeholder="Event name *" value={event.event_name}
            onChange={(e) => setEvent({ ...event, event_name: e.target.value })} />
          <datalist id="store-events">{events.map((ev) => <option key={ev.id} value={ev.name} />)}</datalist>
          <input className={inputCls} placeholder="House (RM, Gooding…)" value={event.event_house}
            onChange={(e) => setEvent({ ...event, event_house: e.target.value })} />
          <input className={inputCls} placeholder="Location" value={event.event_location}
            onChange={(e) => setEvent({ ...event, event_location: e.target.value })} />
          <input className={inputCls} type="date" title="Sale date — sets the FX conversion day for non-USD amounts" value={event.sale_date}
            onChange={(e) => setEvent({ ...event, sale_date: e.target.value })} />
          <select className={inputCls} title="Catalog currency — non-USD amounts are converted to USD at the sale-date ECB rate"
            value={event.currency} onChange={(e) => setEvent({ ...event, currency: e.target.value })}>
            <option value="">USD</option>
            {['EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={loadEventLots} className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-2 rounded">
            Load event lots
          </button>
        </div>
        <FeeScheduleEditor rows={feeRows} setRows={setFeeRows} schedule={feeSchedule}
          error={feeError} currency={event.currency} />
        {event.currency && (
          <p className="text-slate-500 text-xs mt-2">
            {event.currency} amounts are converted to USD at the ECB rate for
            {event.sale_date ? ` ${event.sale_date}` : ' the sale date (set it above, or today’s rate is used)'} when saved.
          </p>
        )}
      </div>

      <div className="flex gap-1 mb-4">
        {[['estimate', 'Pre-auction (estimates)'], ['result', 'Results']].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)}
            className={`px-4 py-2 text-sm font-medium rounded ${mode === id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorNote error={error} />}

      <form onSubmit={submit} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-slate-300 text-sm font-semibold mb-2 uppercase tracking-wide">
          {mode === 'estimate' ? 'Lot entry — before the sale' : 'Lot entry — results'}
          <span className="normal-case font-normal text-slate-500"> — Enter submits, lot # auto-increments</span>
        </h3>
        <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
          <input ref={firstFieldRef} className={inputCls} placeholder="Lot #" value={lot.lot}
            onChange={(e) => setLot({ ...lot, lot: e.target.value })} />
          <input className={inputCls} placeholder="Year" inputMode="numeric" value={lot.year}
            onChange={(e) => setLot({ ...lot, year: e.target.value })} />
          <input className={inputCls} placeholder="Make *" required value={lot.make}
            onChange={(e) => setLot({ ...lot, make: e.target.value })} />
          <input className={`${inputCls} md:col-span-2`} placeholder="Model *" required value={lot.model}
            onChange={(e) => setLot({ ...lot, model: e.target.value })} />
          <input className={inputCls} placeholder="Trim" value={lot.trim}
            onChange={(e) => setLot({ ...lot, trim: e.target.value })} />
          {mode === 'estimate' ? (
            <>
              <input className={inputCls} placeholder="Est. low $" inputMode="numeric" value={lot.estimate_low}
                onChange={(e) => setLot({ ...lot, estimate_low: e.target.value.replace(/[^\d.]/g, '') })} />
              <input className={inputCls} placeholder="Est. high $" inputMode="numeric" value={lot.estimate_high}
                onChange={(e) => setLot({ ...lot, estimate_high: e.target.value.replace(/[^\d.]/g, '') })} />
              <div />
            </>
          ) : (
            <>
              <input className={inputCls} placeholder={lot.outcome === 'sold' ? 'Hammer $ *' : 'High bid $'} inputMode="numeric" value={lot.price}
                onChange={(e) => setLot({ ...lot, price: e.target.value.replace(/[^\d.]/g, '') })} />
              <select className={inputCls} value={lot.outcome} onChange={(e) => setLot({ ...lot, outcome: e.target.value })}>
                <option value="sold">Sold</option>
                <option value="reserve_not_met">RNM</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
              {feeCategories.length > 1 ? (
                <select className={inputCls} title="Which row of the fee table this lot pays"
                  value={lotCategory} onChange={(e) => setLotCategory(e.target.value)}>
                  {feeCategories.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
                </select>
              ) : <div />}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50">
            <Plus size={16} /> {saving ? 'Saving…' : mode === 'estimate' ? 'Add lot with estimate (Enter)' : 'Add result (Enter)'}
          </button>
          {mode === 'result' && lot.outcome === 'sold' && (() => {
            const fee = feeSchedule && lot.price ? computePremium(lot.price, feeSchedule, lotCategory) : null;
            if (!fee) return null;
            return (
              <span className="text-slate-400 text-sm">
                + {fmtMoney(fee.premium, event.currency || 'USD')} premium ({fee.effective_pct}%)
                {' → '}<span className="text-emerald-300">all-in {fmtMoney(fee.price_all_in, event.currency || 'USD')}</span>
              </span>
            );
          })()}
        </div>
      </form>

      {entered.length > 0 && (
        <div className="mt-4">
          <h3 className="text-slate-400 text-sm mb-2">{entered.length} lot(s) entered this session</h3>
          <div className="space-y-1">
            {entered.map((l, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-800/60 rounded px-3 py-2 text-sm text-slate-300">
                <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                <span className="text-slate-500">{l.lot ? `Lot ${l.lot}` : l.id}</span>
                <span>{[l.year, l.make, l.model, l.trim].filter(Boolean).join(' ')}</span>
                {l.mode === 'estimate'
                  ? <span className="text-sky-300">est. {fmtMoney(l.estimate_low)}–{fmtMoney(l.estimate_high)}</span>
                  : (<><Badge className={OUTCOME_BADGE[l.outcome]}>{l.outcome}</Badge><span>{fmtMoney(l.price)}</span>
                      {l.all_in && <span className="text-slate-500">all-in {fmtMoney(l.all_in)}</span>}</>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {eventLots && (
        <div className="mt-6">
          <h3 className="text-slate-300 text-sm font-semibold mb-2 uppercase tracking-wide">
            {event.event_name} — {eventLots.length} lot(s)
            <span className="normal-case font-normal text-slate-500"> — fill in results for upcoming lots after the sale</span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full bg-slate-800">
              <thead className="bg-slate-800/80 border-b border-slate-700">
                <tr><Th>Lot</Th><Th>Vehicle</Th><Th>Estimate</Th><Th>Status</Th><Th>Result</Th><Th></Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {eventLots.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-700/40">
                    <Td className="text-slate-500 whitespace-nowrap">{r.source_listing_id.split('-lot-')[1] || '—'}</Td>
                    <Td>{r.raw_title || [r.year, r.make, r.model].filter(Boolean).join(' ')}</Td>
                    <Td className="whitespace-nowrap">
                      {r.estimate_low || r.estimate_high
                        ? `${fmtMoney(r.estimate_low, r.currency)}–${fmtMoney(r.estimate_high, r.currency)}` : '—'}
                    </Td>
                    <Td><Badge className={r.status === 'ended' ? (OUTCOME_BADGE[r.outcome] || OUTCOME_BADGE.unknown) : 'bg-sky-900/40 text-sky-300'}>
                      {r.status === 'ended' ? r.outcome : r.status}</Badge></Td>
                    {r.status === 'ended' ? (
                      <>
                        <Td>{fmtMoney(r.price, r.currency)}{r.price_all_in ? <span className="text-slate-500"> · all-in {fmtMoney(r.price_all_in, r.currency)}</span> : null}</Td>
                        <Td></Td>
                      </>
                    ) : (
                      <>
                        <Td>
                          <div className="flex gap-1.5">
                            <input className={`${inputCls} w-28 py-1`} placeholder="Price $" inputMode="numeric"
                              value={lotEdits[r.id]?.price ?? ''}
                              onChange={(e) => setLotEdits({ ...lotEdits, [r.id]: { ...lotEdits[r.id], price: e.target.value.replace(/[^\d.]/g, '') } })} />
                            <select className={`${inputCls} py-1`} value={lotEdits[r.id]?.outcome ?? 'sold'}
                              onChange={(e) => setLotEdits({ ...lotEdits, [r.id]: { ...lotEdits[r.id], outcome: e.target.value } })}>
                              <option value="sold">Sold</option>
                              <option value="reserve_not_met">RNM</option>
                              <option value="withdrawn">Withdrawn</option>
                            </select>
                            {feeCategories.length > 1 && (
                              <select className={`${inputCls} py-1`} title="Fee table row for this lot"
                                value={lotEdits[r.id]?.category ?? lotCategory}
                                onChange={(e) => setLotEdits({ ...lotEdits, [r.id]: { ...lotEdits[r.id], category: e.target.value } })}>
                                {feeCategories.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
                              </select>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <button disabled={savingLot === r.id}
                            onClick={() => saveLotResult(r)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">
                            {savingLot === r.id ? 'Saving…' : 'Save result'}
                          </button>
                        </Td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-slate-300 text-sm font-semibold mb-1 uppercase tracking-wide flex items-center gap-2">
          <Sparkles size={15} className="text-amber-300" /> AI import
        </h3>
        <p className="text-slate-500 text-xs mb-2">
          Paste an auction-house {mode === 'estimate' ? 'catalog' : 'results'} page URL or its text.
          Claude extracts the lots for review; nothing is saved until you import.
        </p>
        <textarea className={`${inputCls} w-full h-24 font-mono text-xs`}
          placeholder={'https://…  — or paste the page text here'}
          value={aiInput} onChange={(e) => setAiInput(e.target.value)} />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={runExtract} disabled={aiBusy || !aiInput.trim()}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
            <Sparkles size={14} /> {aiBusy ? 'Extracting…' : `Extract ${mode === 'estimate' ? 'catalog' : 'results'}`}
          </button>
          {staged && (
            <button onClick={importStaged} disabled={importing}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
              <Plus size={14} /> {importing ? `Importing… ${importedCount}` : `Import ${staged.filter((l) => l._include).length} lot(s)`}
            </button>
          )}
          {importedCount > 0 && !importing && (
            <span className="text-emerald-400 text-sm">{importedCount} imported ✓</span>
          )}
        </div>
        {aiNote && <p className="text-amber-300/90 text-xs mt-2">{aiNote}</p>}

        {staged && (
          <div className="overflow-x-auto rounded-lg border border-slate-700 mt-3">
            <table className="w-full bg-slate-800/60">
              <thead className="bg-slate-800/80 border-b border-slate-700">
                <tr><Th></Th><Th>Lot</Th><Th>Year</Th><Th>Make</Th><Th>Model</Th><Th>Est. low</Th><Th>Est. high</Th><Th>Price</Th><Th>Cur</Th><Th>Outcome</Th>
                  {feeCategories.length > 1 && <Th>Fee row</Th>}</tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {staged.map((l, i) => (
                  <tr key={i} className={l._include ? '' : 'opacity-40'}>
                    <Td><input type="checkbox" checked={l._include} onChange={(e) => setStagedField(i, '_include', e.target.checked)} /></Td>
                    <Td><input className={`${inputCls} w-16 py-1`} value={l.lot ?? ''} onChange={(e) => setStagedField(i, 'lot', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-16 py-1`} value={l.year ?? ''} onChange={(e) => setStagedField(i, 'year', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-28 py-1`} value={l.make ?? ''} onChange={(e) => setStagedField(i, 'make', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-40 py-1`} value={l.model ?? ''} onChange={(e) => setStagedField(i, 'model', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-24 py-1`} value={l.estimate_low ?? ''} onChange={(e) => setStagedField(i, 'estimate_low', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-24 py-1`} value={l.estimate_high ?? ''} onChange={(e) => setStagedField(i, 'estimate_high', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-24 py-1`} value={l.price ?? ''} onChange={(e) => setStagedField(i, 'price', e.target.value)} /></Td>
                    <Td><input className={`${inputCls} w-14 py-1`} placeholder="USD" value={l.currency ?? ''} onChange={(e) => setStagedField(i, 'currency', e.target.value.toUpperCase() || null)} /></Td>
                    <Td>
                      <select className={`${inputCls} py-1`} value={l.outcome ?? ''} onChange={(e) => setStagedField(i, 'outcome', e.target.value || null)}>
                        <option value="">not run yet</option>
                        <option value="sold">sold</option>
                        <option value="reserve_not_met">RNM</option>
                        <option value="withdrawn">withdrawn</option>
                      </select>
                    </Td>
                    {feeCategories.length > 1 && (
                      <Td>
                        <select className={`${inputCls} py-1`} value={l.category ?? lotCategory}
                          onChange={(e) => setStagedField(i, 'category', e.target.value)}>
                          {feeCategories.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
                        </select>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


// -------------------------------------------------------------- Review queue
function ReviewQueue() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [buckets, setBuckets] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [newBucketFor, setNewBucketFor] = useState(null); // listing id
  const [newBucket, setNewBucket] = useState({ make: '', model: '', generation: '' });
  const [choice, setChoice] = useState({}); // listing id -> bucket id
  const eventsById = useEventsById();

  // AI first pass
  const [ai, setAi] = useState(null); // { groups, buckets_to_create }
  const [aiBusy, setAiBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [q, b] = await Promise.all([api('/api/store/review'), api('/api/store/buckets')]);
      setRows(q.rows); setTotal(q.total ?? q.rows.length); setBuckets(b.rows);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (body, id) => {
    setBusyId(id); setError(null);
    try {
      await api('/api/store/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load();
      setNewBucketFor(null);
    } catch (e) { setError(e.message); }
    setBusyId(null);
  };

  const runSuggest = async () => {
    setAiBusy(true); setError(null); setAi(null); setApplyResult(null);
    try {
      const data = await api('/api/store/review/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setAi({
        groups: (data.groups || []).map((g) => ({ ...g, _include: g.action !== 'skip' && g.confidence !== 'low' })),
        buckets_to_create: data.buckets_to_create || [],
        warning: data.warning || null,
        usage: data.usage || null,
        model: data.model || null,
      });
    } catch (e) { setError(e.message); }
    setAiBusy(false);
  };

  const setAiBucketField = (i, field, value) => {
    setAi((prev) => ({
      ...prev,
      buckets_to_create: prev.buckets_to_create.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)),
    }));
  };

  const applySuggestions = async () => {
    if (!ai) return;
    setApplying(true); setError(null);
    try {
      const picked = ai.groups.filter((g) => g._include && g.action !== 'skip');
      const usedKeys = new Set(picked.filter((g) => g.new_bucket_key).map((g) => g.new_bucket_key));
      const data = await api('/api/store/review/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply: true,
          buckets: ai.buckets_to_create.filter((b) => usedKeys.has(b.key)),
          assignments: picked.map((g) => ({
            make: g.make, model: g.model, trim: g.trim,
            bucket_id: g.bucket_id, new_bucket_key: g.new_bucket_key,
          })),
        }),
      });
      setApplyResult(data);
      setAi(null);
      await load();
    } catch (e) { setError(e.message); }
    setApplying(false);
  };

  const bucketName = (id) => {
    const b = buckets.find((x) => x.id === id);
    return b ? `${b.make} ${b.model}${b.generation ? ` (${b.generation})` : ''}` : id;
  };
  const newBucketLabel = (key) => {
    const b = ai?.buckets_to_create.find((x) => x.key === key);
    return b ? `NEW: ${b.make} ${b.model}${b.generation ? ` (${b.generation})` : ''} ${b.year_min ?? '?'}–${b.year_max ?? 'now'}` : key;
  };
  const CONF_BADGE = {
    high: 'bg-emerald-900/40 text-emerald-300',
    medium: 'bg-amber-900/40 text-amber-300',
    low: 'bg-red-900/40 text-red-300',
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-slate-400 text-sm">
          {total.toLocaleString()} listing(s) need review. Assigning a bucket also registers the alias, so the
          same make/model string never comes back.
        </p>
        <button onClick={runSuggest} disabled={aiBusy || rows.length === 0}
          className="flex items-center gap-2 shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
          <Sparkles size={14} /> {aiBusy ? 'Suggesting…' : 'AI suggest'}
        </button>
      </div>
      {error && <ErrorNote error={error} />}
      {applyResult && (
        <div className="bg-emerald-900/30 border border-emerald-800 text-emerald-300 text-sm rounded-lg p-3 mb-3">
          Applied: {applyResult.buckets_created} bucket(s) created, {applyResult.aliases_registered} alias(es) registered,
          {' '}{applyResult.listings_claimed} listing(s) claimed.
          {applyResult.rejected_count > 0 && ` ${applyResult.rejected_count} rejected as automobilia/parts: ${applyResult.rejected.join('; ')}`}
          {applyResult.errors?.length > 0 && ` Errors: ${applyResult.errors.join('; ')}`}
        </div>
      )}

      {ai && (
        <div className="bg-slate-800 border border-amber-700/50 rounded-lg p-4 mb-4">
          <h3 className="text-slate-200 text-sm font-semibold mb-1 flex items-center gap-2">
            <Sparkles size={14} className="text-amber-300" /> AI first pass — nothing is saved until you apply
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            Uncheck anything that looks wrong (low-confidence rows start unchecked). Production years on new
            buckets are editable below.
          </p>
          {ai.warning && (
            <div className="bg-amber-900/30 border border-amber-800 text-amber-300 text-xs rounded p-2 mb-3">
              {ai.warning}
            </div>
          )}
          {ai.usage && (
            <p className="text-slate-600 text-xs mb-3">
              {ai.model} · {ai.usage.input_tokens.toLocaleString()} in / {ai.usage.output_tokens.toLocaleString()} out
              {ai.usage.cache_read_input_tokens > 0 && ` · ${ai.usage.cache_read_input_tokens.toLocaleString()} cached (10% price)`}
              {ai.usage.cache_creation_input_tokens > 0 && ` · ${ai.usage.cache_creation_input_tokens.toLocaleString()} written to cache`}
            </p>
          )}

          {ai.buckets_to_create.length > 0 && (
            <div className="mb-4">
              <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5">New buckets to create</h4>
              <div className="space-y-1.5">
                {ai.buckets_to_create.map((b, i) => (
                  <div key={b.key} className="flex flex-wrap items-center gap-1.5">
                    <input className={`${inputCls} w-32 py-1`} value={b.make} onChange={(e) => setAiBucketField(i, 'make', e.target.value)} />
                    <input className={`${inputCls} w-40 py-1`} value={b.model} onChange={(e) => setAiBucketField(i, 'model', e.target.value)} />
                    <input className={`${inputCls} w-24 py-1`} placeholder="Gen" value={b.generation ?? ''} onChange={(e) => setAiBucketField(i, 'generation', e.target.value || null)} />
                    <input className={`${inputCls} w-20 py-1`} placeholder="Yr min" inputMode="numeric" value={b.year_min ?? ''} onChange={(e) => setAiBucketField(i, 'year_min', e.target.value.replace(/\D/g, '') || null)} />
                    <span className="text-slate-600">–</span>
                    <input className={`${inputCls} w-20 py-1`} placeholder="Yr max" inputMode="numeric" value={b.year_max ?? ''} onChange={(e) => setAiBucketField(i, 'year_max', e.target.value.replace(/\D/g, '') || null)} />
                    <span className="text-slate-500 text-xs">
                      ← {ai.groups.filter((g) => g.new_bucket_key === b.key && g._include).length} string(s)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5">Assignments</h4>
          <div className="space-y-1">
            {ai.groups.map((g, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-2 text-sm rounded px-2 py-1 ${g._include ? 'bg-slate-700/40' : 'opacity-50'}`}>
                <input type="checkbox" checked={g._include} disabled={g.action === 'skip'}
                  onChange={(e) => setAi((prev) => ({ ...prev, groups: prev.groups.map((x, idx) => (idx === i ? { ...x, _include: e.target.checked } : x)) }))} />
                <span className="text-slate-300">{[g.make, g.model, g.trim].filter(Boolean).join(' / ')}</span>
                <span className="text-slate-600">({g.listing_count})</span>
                <span className="text-slate-500">→</span>
                <span className="text-slate-200">
                  {g.action === 'skip' ? <span className="text-slate-500">skip</span>
                    : g.bucket_id ? bucketName(g.bucket_id)
                    : newBucketLabel(g.new_bucket_key)}
                </span>
                <Badge className={CONF_BADGE[g.confidence]}>{g.confidence}</Badge>
                {g.note && <span className="text-slate-500 text-xs italic">{g.note}</span>}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button onClick={applySuggestions} disabled={applying || ai.groups.every((g) => !g._include)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
              <CheckCircle size={14} /> {applying ? 'Applying…' : `Apply ${ai.groups.filter((g) => g._include).length} assignment(s)`}
            </button>
            <button onClick={() => setAi(null)} className="text-slate-400 hover:text-slate-200 text-sm">Discard</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-slate-200 text-sm truncate">{r.raw_title || '—'}</div>
                <div className="text-slate-500 text-xs">
                  raw: <span className="text-slate-400">{[r.make, r.model, r.trim].filter(Boolean).join(' / ') || 'no make/model'}</span>
                  {' · '}<SourceCell row={r} eventsById={eventsById} />
                  {r.currency !== 'USD' && <Badge className="ml-1 bg-purple-900/40 text-purple-300">{r.currency}</Badge>}
                  {' '}{fmtMoney(r.price ?? r.current_bid, r.currency)} · {fmtDate(r.ended_at)}
                </div>
              </div>
              <select className={inputCls} value={choice[r.id] || ''} onChange={(e) => setChoice({ ...choice, [r.id]: e.target.value })}>
                <option value="">Pick bucket…</option>
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.make} {b.model}{b.generation ? ` (${b.generation})` : ''} — {b.listing_count}
                  </option>
                ))}
              </select>
              <button disabled={!choice[r.id] || busyId === r.id}
                onClick={() => act({ action: 'assign', canonical_model_id: choice[r.id], make: r.make, model: r.model, trim: r.trim }, r.id)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
                Assign
              </button>
              <button onClick={() => { setNewBucketFor(newBucketFor === r.id ? null : r.id); setNewBucket({ make: r.make || '', model: r.model || '', generation: '' }); }}
                className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1.5 rounded">
                New bucket
              </button>
              <button disabled={busyId === r.id} onClick={() => act({ action: 'dismiss', listing_id: r.id }, r.id)}
                className="text-slate-400 hover:text-slate-200 text-sm px-2" title="Clear the flag without assigning">
                <XCircle size={16} />
              </button>
            </div>
            {newBucketFor === r.id && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-700">
                <input className={inputCls} placeholder="Bucket make" value={newBucket.make}
                  onChange={(e) => setNewBucket({ ...newBucket, make: e.target.value })} />
                <input className={inputCls} placeholder="Bucket model" value={newBucket.model}
                  onChange={(e) => setNewBucket({ ...newBucket, model: e.target.value })} />
                <input className={inputCls} placeholder="Generation (964, E30…)" value={newBucket.generation}
                  onChange={(e) => setNewBucket({ ...newBucket, generation: e.target.value })} />
                <button disabled={!newBucket.make || !newBucket.model || busyId === r.id}
                  onClick={() => act({ action: 'create_and_assign', bucket: newBucket, make: r.make, model: r.model, trim: r.trim }, r.id)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-40">
                  Create + assign
                </button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && !error && (
          <div className="text-slate-500 text-sm bg-slate-800/60 rounded-lg p-6 text-center">Review queue is empty. 🎉</div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Buckets

// One alias inside a bucket's expanded alias editor: repoint it to another
// bucket (optionally taking its listings along) or delete it.
function AliasRow({ a, buckets, onDone, onError }) {
  const [target, setTarget] = useState('');
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);

  const repoint = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const data = await api('/api/store/buckets/aliases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: a.alias, canonical_model_id: target, move_listings: move }),
      });
      await onDone(move ? `Alias repointed — ${data.listings_moved} listing(s) moved with it.` : 'Alias repointed.');
    } catch (e) { onError(e.message); }
    setBusy(false);
  };

  const del = async () => {
    if (!window.confirm(`Delete alias “${a.alias}”? Its listings keep their bucket; the raw string will re-enter the review queue next time it appears.`)) return;
    setBusy(true);
    try {
      await api('/api/store/buckets/aliases', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: a.alias }),
      });
      await onDone('Alias deleted.');
    } catch (e) { onError(e.message); }
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <code className="text-slate-200 text-xs bg-slate-900/60 px-2 py-1 rounded">{a.alias}</code>
      <span className="text-slate-500 text-xs">{a.listing_count} listing(s)</span>
      <span className="flex-1" />
      <select className={`${inputCls} py-1 text-xs`} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Repoint to…</option>
        {buckets.filter((b) => b.id !== a.canonical_model_id).map((b) => (
          <option key={b.id} value={b.id}>{b.make} {b.model}{b.generation ? ` (${b.generation})` : ''}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-400" title="Also move this alias's listings to the new bucket. Listings with their own trim-level alias, or ones you placed by hand, stay put.">
        <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> move listings
      </label>
      <button onClick={repoint} disabled={busy || !target}
        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2.5 py-1 rounded disabled:opacity-50">
        Repoint
      </button>
      <button onClick={del} disabled={busy} title="Delete alias"
        className="text-slate-500 hover:text-red-400 disabled:opacity-50">
        <XCircle size={14} />
      </button>
    </div>
  );
}

function Buckets() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ make: '', model: '', generation: '', year_min: '', year_max: '' });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  // Inline bucket editor + per-bucket alias panel.
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [aliasesFor, setAliasesFor] = useState(null);
  const [aliases, setAliases] = useState([]);

  const load = useCallback(async () => {
    setError(null);
    try { setRows((await api('/api/store/buckets')).rows); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api('/api/store/buckets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setForm({ make: '', model: '', generation: '', year_min: '', year_max: '' });
      await load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const openEdit = (b) => {
    setError(null); setNotice(null);
    setEditingId(b.id);
    setEdit({
      make: b.make, model: b.model, generation: b.generation || '',
      year_min: b.year_min ?? '', year_max: b.year_max ?? '',
    });
  };
  const saveEdit = async () => {
    setSavingEdit(true); setError(null);
    try {
      await api('/api/store/buckets', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...edit }),
      });
      setEditingId(null);
      await load();
    } catch (e) { setError(e.message); }
    setSavingEdit(false);
  };

  const loadAliases = useCallback(async (bucketId) => {
    setAliases((await api(`/api/store/buckets?aliases_for=${bucketId}`)).rows);
  }, []);
  const toggleAliases = async (b) => {
    setError(null); setNotice(null);
    if (aliasesFor === b.id) { setAliasesFor(null); setAliases([]); return; }
    setAliasesFor(b.id); setAliases([]);
    try { await loadAliases(b.id); } catch (e) { setError(e.message); }
  };
  // After a repoint/delete, refresh the open alias list and the counts.
  const aliasDone = async (msg) => {
    setNotice(msg);
    try { if (aliasesFor) await loadAliases(aliasesFor); await load(); } catch (e) { setError(e.message); }
  };

  const filtered = useMemo(
    () => rows.filter((b) => !q || `${b.make} ${b.model} ${b.generation || ''}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );

  return (
    <div className="max-w-4xl">
      <p className="text-slate-400 text-sm mb-4">
        A <span className="text-slate-200">bucket</span> is one canonical vehicle — a make + model (optionally a
        generation and year range), e.g. “Porsche 911 (964)”. Auction sites describe the same car dozens of ways
        (“Porsche 997 911 Turbo”, “2011 Porsche 911 Turbo S”…), so listings are grouped into buckets to build one
        comparable price history per vehicle. Assigning a listing to a bucket (here or in the Review Queue) also
        saves that raw make/model string as an alias, so future listings with the same string match automatically.
        “Listings” is how many auctions are in the bucket; “Aliases” is how many raw name variants map to it.
      </p>
      <form onSubmit={create} className="flex flex-wrap gap-2 mb-4 items-center bg-slate-800 border border-slate-700 rounded-lg p-3">
        <input className={inputCls} placeholder="Make *" required value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
        <input className={inputCls} placeholder="Model *" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input className={inputCls} placeholder="Generation" value={form.generation} onChange={(e) => setForm({ ...form, generation: e.target.value })} />
        <input className={`${inputCls} w-24`} placeholder="Yr min" inputMode="numeric" value={form.year_min} onChange={(e) => setForm({ ...form, year_min: e.target.value })} />
        <input className={`${inputCls} w-24`} placeholder="Yr max" inputMode="numeric" value={form.year_max} onChange={(e) => setForm({ ...form, year_max: e.target.value })} />
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded disabled:opacity-50">
          <Plus size={14} /> Create bucket
        </button>
      </form>
      {error && <ErrorNote error={error} />}
      {notice && (
        <div className="bg-emerald-900/30 border border-emerald-800 text-emerald-300 text-sm rounded-lg p-3 mb-3">{notice}</div>
      )}
      <input className={`${inputCls} mb-3 w-64`} placeholder="Filter buckets…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr><Th>Make</Th><Th>Model</Th><Th>Generation</Th><Th>Years</Th><Th>Listings</Th><Th>Aliases</Th><Th>Edit</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {filtered.map((b) => (
              <React.Fragment key={b.id}>
              <tr className="hover:bg-slate-700/40">
                <Td>{b.make}</Td><Td>{b.model}</Td><Td>{b.generation || '—'}</Td>
                <Td>{b.year_min || b.year_max ? `${b.year_min ?? '…'}–${b.year_max ?? '…'}` : '—'}</Td>
                <Td className={Number(b.listing_count) < 10 ? 'text-amber-400' : ''}>{b.listing_count}</Td>
                <Td>
                  <button onClick={() => toggleAliases(b)} title="Show this bucket's aliases"
                    className={`underline decoration-dotted underline-offset-2 ${aliasesFor === b.id ? 'text-blue-300' : 'text-slate-300 hover:text-blue-300'}`}>
                    {b.alias_count}
                  </button>
                </Td>
                <Td>
                  <button onClick={() => (editingId === b.id ? setEditingId(null) : openEdit(b))}
                    className="text-slate-400 hover:text-blue-300" title="Edit make / model / generation / years">
                    <Pencil size={14} />
                  </button>
                </Td>
              </tr>
              {editingId === b.id && (
                <tr className="bg-slate-800/80">
                  <Td className="!p-0" colSpan={7}>
                    <div className="px-4 py-3 border-y border-blue-700/40 bg-slate-900/40 flex flex-wrap items-center gap-2">
                      <input className={`${inputCls} w-36 py-1`} placeholder="Make *" value={edit.make}
                        onChange={(e) => setEdit({ ...edit, make: e.target.value })} />
                      <input className={`${inputCls} w-44 py-1`} placeholder="Model *" value={edit.model}
                        onChange={(e) => setEdit({ ...edit, model: e.target.value })} />
                      <input className={`${inputCls} w-28 py-1`} placeholder="Generation" value={edit.generation}
                        onChange={(e) => setEdit({ ...edit, generation: e.target.value })} />
                      <input className={`${inputCls} w-24 py-1`} placeholder="Yr min" inputMode="numeric" value={edit.year_min}
                        onChange={(e) => setEdit({ ...edit, year_min: e.target.value.replace(/\D/g, '') })} />
                      <span className="text-slate-600">–</span>
                      <input className={`${inputCls} w-24 py-1`} placeholder="Yr max" inputMode="numeric" value={edit.year_max}
                        onChange={(e) => setEdit({ ...edit, year_max: e.target.value.replace(/\D/g, '') })} />
                      <button onClick={saveEdit} disabled={savingEdit || !edit.make || !edit.model}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                        <CheckCircle size={14} /> {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1.5">Cancel</button>
                      <span className="text-slate-500 text-xs w-full">Clearing generation or a year clears it in the store. Renames apply to the bucket everywhere — its listings and aliases stay attached.</span>
                    </div>
                  </Td>
                </tr>
              )}
              {aliasesFor === b.id && (
                <tr className="bg-slate-800/80">
                  <Td className="!p-0" colSpan={7}>
                    <div className="px-4 py-2 border-y border-slate-600/60 bg-slate-900/40">
                      <p className="text-slate-400 text-xs pt-1">
                        Raw make/model strings mapping into “{b.make} {b.model}{b.generation ? ` (${b.generation})` : ''}”.
                        Repoint one to send its listings (and all future matches) to a different bucket, or delete it
                        to make the string reviewable again.
                      </p>
                      <div className="divide-y divide-slate-700/40">
                        {aliases.map((a) => (
                          <AliasRow key={a.alias} a={a} buckets={rows} onDone={aliasDone} onError={setError} />
                        ))}
                        {aliases.length === 0 && <p className="text-slate-500 text-xs py-2">No aliases registered for this bucket.</p>}
                      </div>
                    </div>
                  </Td>
                </tr>
              )}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={7}>No buckets yet — create them here or from the review queue.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-slate-500 text-xs mt-2">Listing counts under 10 are highlighted — likely too thin to index.</p>
    </div>
  );
}

function ErrorNote({ error }) {
  const unconfigured = /not configured/i.test(error || '');
  return (
    <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg p-3 mb-3">
      {error}
      {unconfigured && (
        <div className="text-red-200/80 mt-1">
          Set <code>CANONICAL_SUPABASE_URL</code> and <code>CANONICAL_SUPABASE_SERVICE_ROLE_KEY</code> in
          Vercel (the project where you ran <code>auction-store/schema.sql</code>), then redeploy.
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- Shell
const TABS = [
  { id: 'live', label: 'Live Board', icon: Radio, el: <LiveBoard /> },
  { id: 'results', label: 'Results', icon: Rows3, el: <Results /> },
  { id: 'entry', label: 'Live Entry', icon: Gavel, el: <LiveEntry /> },
  { id: 'review', label: 'Review Queue', icon: ListChecks, el: <ReviewQueue /> },
  { id: 'buckets', label: 'Buckets', icon: FolderTree, el: <Buckets /> },
  { id: 'comparables', label: 'Comparables', icon: LineChart, el: <BucketComparables /> },
  { id: 'livesales', label: 'Live Sales', icon: Gavel, el: <LiveSales /> },
  { id: 'demand', label: 'Demand Signals', icon: Eye, el: <DemandSignals /> },
  { id: 'pulse', label: 'Market Pulse', icon: Activity, el: <MarketPulse /> },
];

export default function CanonicalStorePanel() {
  const [tab, setTab] = useState('live');
  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Canonical Auction Store</h1>
            <p className="text-slate-400 text-sm">All sources, one table — BaT · Cars & Bids · live auctions</p>
          </div>
          <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Game admin</a>
        </div>
        <div className="flex gap-1 mb-6 border-b border-slate-700">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition ${
                tab === id ? 'bg-slate-800 text-white border border-slate-700 border-b-transparent' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {TABS.find((t) => t.id === tab)?.el}
      </div>
    </div>
  );
}
