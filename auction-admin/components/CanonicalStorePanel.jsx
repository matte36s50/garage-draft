'use client'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw, Download, Search, Plus, CheckCircle, XCircle, ExternalLink,
  Gavel, ListChecks, Rows3, FolderTree, Radio,
} from 'lucide-react';

/**
 * Unified admin panel for the canonical auction store (plan §5, Phase 3 MVP).
 * Tabs: Live Board · Results · Live Entry · Review Queue · Buckets.
 * All data flows through /api/store/* server routes (service key stays
 * server-side); this component never talks to Supabase directly.
 */

const fmtMoney = (v, cur = 'USD') =>
  v == null ? '—' : `${cur === 'USD' ? '$' : `${cur} `}${Number(v).toLocaleString()}`;
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');
const OUTCOME_BADGE = {
  sold: 'bg-emerald-900/40 text-emerald-300',
  reserve_not_met: 'bg-amber-900/40 text-amber-300',
  withdrawn: 'bg-red-900/40 text-red-300',
  unknown: 'bg-slate-700 text-slate-300',
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

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
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api('/api/store/listings?status=upcoming,live&sort=ends_at&dir=asc&limit=200');
      setRows(data.rows);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-400 text-sm">Upcoming + live listings across all sources, soonest ending first.</p>
        <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr><Th>Ends</Th><Th>Title</Th><Th>Source</Th><Th>Current bid</Th><Th>Status</Th><Th>Link</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-700/40">
                <Td className="whitespace-nowrap">{r.ends_at ? new Date(r.ends_at).toLocaleString() : '—'}</Td>
                <Td>{r.raw_title || `${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`}</Td>
                <Td><Badge>{r.source_id}</Badge></Td>
                <Td>{fmtMoney(r.current_bid, r.currency)}</Td>
                <Td><Badge className={r.status === 'live' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-sky-900/40 text-sky-300'}>{r.status}</Badge></Td>
                <Td>{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300"><ExternalLink size={14} /></a>}</Td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={6}>No live or upcoming listings in the store yet.</Td></tr>
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
    const cols = ['source_id','source_listing_id','raw_title','year','make','model','outcome','price','price_all_in','currency','bid_count','views','comments','ended_at','url'];
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
            <tr><Th>Ended</Th><Th>Title</Th><Th>Source</Th><Th>Outcome</Th><Th>Price</Th><Th>All-in</Th><Th>Bids</Th><Th>Views</Th><Th>Link</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-700/40">
                <Td className="whitespace-nowrap">{fmtDate(r.ended_at)}</Td>
                <Td>
                  {r.raw_title || `${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`}
                  {r.needs_review && <Badge className="ml-2 bg-amber-900/40 text-amber-300">review</Badge>}
                </Td>
                <Td><Badge>{r.source_id}</Badge></Td>
                <Td><Badge className={OUTCOME_BADGE[r.outcome] || OUTCOME_BADGE.unknown}>{r.outcome || '—'}</Badge></Td>
                <Td>{fmtMoney(r.price, r.currency)}</Td>
                <Td>{fmtMoney(r.price_all_in, r.currency)}</Td>
                <Td>{r.bid_count ?? '—'}</Td>
                <Td>{r.views != null ? Number(r.views).toLocaleString() : '—'}</Td>
                <Td>{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300"><ExternalLink size={14} /></a>}</Td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={9}>No results match.</Td></tr>
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

// ---------------------------------------------------------------- Live entry
function LiveEntry() {
  const [event, setEvent] = useState({ event_name: '', event_house: '', event_location: '', buyer_premium_pct: '' });
  const [events, setEvents] = useState([]);
  const [lot, setLot] = useState({ lot: '', year: '', make: '', model: '', trim: '', price: '', outcome: 'sold' });
  const [entered, setEntered] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    api('/api/store/events').then((d) => setEvents(d.rows || [])).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError(null); setSaving(true);
    try {
      const body = { ...event, ...lot };
      if (event.buyer_premium_pct !== '' && lot.outcome === 'sold') body.buyer_premium_pct = event.buyer_premium_pct;
      const data = await api('/api/store/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setEntered((prev) => [{ ...body, id: data.source_listing_id, all_in: data.payload.price_all_in }, ...prev]);
      setLot({ lot: lot.lot ? String(Number(lot.lot) + 1 || '') : '', year: '', make: '', model: '', trim: '', price: '', outcome: 'sold' });
      firstFieldRef.current?.focus();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 mb-4">
        <h3 className="text-slate-300 text-sm font-semibold mb-2 uppercase tracking-wide">Event</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={inputCls} list="store-events" placeholder="Event name *" value={event.event_name}
            onChange={(e) => setEvent({ ...event, event_name: e.target.value })} />
          <datalist id="store-events">{events.map((ev) => <option key={ev.id} value={ev.name} />)}</datalist>
          <input className={inputCls} placeholder="House (RM, Gooding…)" value={event.event_house}
            onChange={(e) => setEvent({ ...event, event_house: e.target.value })} />
          <input className={inputCls} placeholder="Location" value={event.event_location}
            onChange={(e) => setEvent({ ...event, event_location: e.target.value })} />
          <input className={inputCls} type="number" step="0.5" placeholder="Buyer premium % (default)" value={event.buyer_premium_pct}
            onChange={(e) => setEvent({ ...event, buyer_premium_pct: e.target.value })} />
        </div>
      </div>

      <form onSubmit={submit} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-slate-300 text-sm font-semibold mb-2 uppercase tracking-wide">
          Lot entry <span className="normal-case font-normal text-slate-500">— Enter submits, focus returns to Lot #</span>
        </h3>
        <div className="grid grid-cols-3 md:grid-cols-8 gap-2">
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
          <input className={inputCls} placeholder={lot.outcome === 'sold' ? 'Hammer $ *' : 'High bid $'} inputMode="numeric" value={lot.price}
            onChange={(e) => setLot({ ...lot, price: e.target.value.replace(/[^\d.]/g, '') })} />
          <select className={inputCls} value={lot.outcome} onChange={(e) => setLot({ ...lot, outcome: e.target.value })}>
            <option value="sold">Sold</option>
            <option value="reserve_not_met">RNM</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50">
            <Plus size={16} /> {saving ? 'Saving…' : 'Add lot (Enter)'}
          </button>
          {error && <span className="text-red-400 text-sm">{error}</span>}
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
                <Badge className={OUTCOME_BADGE[l.outcome]}>{l.outcome}</Badge>
                <span>{fmtMoney(l.price)}</span>
                {l.all_in && <span className="text-slate-500">all-in {fmtMoney(l.all_in)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
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

  return (
    <div className="max-w-5xl">
      <p className="text-slate-400 text-sm mb-3">
        {total.toLocaleString()} listing(s) need review. Assigning a bucket also registers the alias, so the
        same make/model string never comes back.
      </p>
      {error && <ErrorNote error={error} />}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-slate-200 text-sm truncate">{r.raw_title || '—'}</div>
                <div className="text-slate-500 text-xs">
                  raw: <span className="text-slate-400">{[r.make, r.model, r.trim].filter(Boolean).join(' / ') || 'no make/model'}</span>
                  {' · '}<Badge>{r.source_id}</Badge>
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
function Buckets() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ make: '', model: '', generation: '', year_min: '', year_max: '' });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

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

  const filtered = useMemo(
    () => rows.filter((b) => !q || `${b.make} ${b.model} ${b.generation || ''}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );

  return (
    <div className="max-w-4xl">
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
      <input className={`${inputCls} mb-3 w-64`} placeholder="Filter buckets…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr><Th>Make</Th><Th>Model</Th><Th>Generation</Th><Th>Years</Th><Th>Listings</Th><Th>Aliases</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {filtered.map((b) => (
              <tr key={b.id} className="hover:bg-slate-700/40">
                <Td>{b.make}</Td><Td>{b.model}</Td><Td>{b.generation || '—'}</Td>
                <Td>{b.year_min || b.year_max ? `${b.year_min ?? '…'}–${b.year_max ?? '…'}` : '—'}</Td>
                <Td className={Number(b.listing_count) < 10 ? 'text-amber-400' : ''}>{b.listing_count}</Td>
                <Td>{b.alias_count}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><Td className="text-slate-500 py-6 text-center" colSpan={6}>No buckets yet — create them here or from the review queue.</Td></tr>
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
