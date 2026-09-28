'use client'
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, GitMerge, Tag, Pencil, ArrowRightLeft, Sparkles, X } from 'lucide-react';
import { api } from '../lib/adminApi';

/**
 * Sale Cleanup — tidy live-auction events in the canonical store.
 *
 * The same sale often arrives twice (game mirror + Live Entry), under a
 * typo'd name, or with the entry day as its date, and most game-sourced sales
 * carry no estimates, which the Manufacturer Apex Index needs. Three tools:
 *   Edit      rename an event, set its house and sale dates
 *   Merge     fold a duplicate event into the one to keep, combining lots that
 *             are the same car (ticked by a human in the preview)
 *   Estimates read a catalogue and attach its estimates to lots the event
 *             already holds, without creating new lots
 * Matching logic: lib/lotMatch.js. Store side: auction_merge_events /
 * auction_update_event in cc-market-survey/auction-store/schema.sql.
 */

const fmtMoney = (v, cur = 'USD') =>
  v == null ? '—' : `${cur === 'USD' ? '$' : `${cur} `}${Number(v).toLocaleString()}`;
const fmtEst = (lo, hi, cur) =>
  lo == null && hi == null ? '—' : `${fmtMoney(lo, cur)}–${fmtMoney(hi, cur)}`;
const inputCls = 'p-2 rounded bg-slate-700 text-white border border-slate-600 focus:border-blue-400 outline-none text-sm';
const btn = 'flex items-center gap-2 text-sm px-3 py-1.5 rounded disabled:opacity-50';

function Th({ children, className = '' }) {
  return <th className={`px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide ${className}`}>{children}</th>;
}
function Td({ children, className = '', colSpan }) {
  return <td colSpan={colSpan} className={`px-3 py-2 text-sm text-slate-200 align-top ${className}`}>{children}</td>;
}
function Note({ kind = 'error', children, onClose }) {
  const cls = kind === 'error'
    ? 'bg-red-900/30 border-red-800 text-red-300'
    : 'bg-emerald-900/30 border-emerald-800 text-emerald-300';
  return (
    <div className={`border text-sm rounded-lg p-3 mb-3 flex items-start justify-between gap-3 ${cls}`}>
      <div>{children}</div>
      {onClose && <button onClick={onClose} className="opacity-70 hover:opacity-100"><X size={14} /></button>}
    </div>
  );
}

const eventLabel = (e) => {
  if (!e) return '';
  const house = (e.house || '').trim();
  const name = (e.name || '').trim();
  if (!house || house.toLowerCase() === name.toLowerCase() || name.toLowerCase().startsWith(house.toLowerCase())) return name;
  return `${house} · ${name}`;
};

function LotCell({ lot, showEstimate = true }) {
  if (!lot) return <span className="text-slate-500">—</span>;
  return (
    <div>
      <div className="text-slate-100">{lot.lot ? <span className="text-slate-400">#{lot.lot} </span> : null}{lot.title}</div>
      <div className="text-xs text-slate-400 mt-0.5">
        {lot.status}{lot.outcome ? ` · ${lot.outcome}` : ''}
        {lot.price != null ? ` · ${fmtMoney(lot.price, lot.currency)}` : ''}
        {showEstimate && (lot.estimate_low != null || lot.estimate_high != null)
          ? ` · est. ${fmtEst(lot.estimate_low, lot.estimate_high, lot.currency)}` : ''}
        {String(lot.source_listing_id || '').startsWith('manual_') ? ' · from game' : ''}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ merge
function MergePanel({ events, initial, onDone, onClose }) {
  const [from, setFrom] = useState(initial.from || '');
  const [into, setInto] = useState(initial.into || '');
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (f, t) => {
    if (!f || !t || f === t) { setPreview(null); return; }
    setBusy(true); setError(null);
    try {
      const data = await api('/api/store/sales/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: f, into: t }),
      });
      setPreview(data);
      setTicked(Object.fromEntries(data.pairs.map((p) => [p.drop.id, p.confidence === 'high'])));
    } catch (e) { setError(e.message); setPreview(null); }
    setBusy(false);
  }, []);
  useEffect(() => { load(from, into); }, [from, into, load]);

  const chosen = preview ? preview.pairs.filter((p) => ticked[p.drop.id]) : [];
  const moving = preview ? preview.move.length + (preview.pairs.length - chosen.length) : 0;

  const apply = async () => {
    if (!preview) return;
    const msg = `Merge "${eventLabel(preview.from)}" into "${eventLabel(preview.into)}"?\n\n`
      + `${chosen.length} pair(s) combined into one lot each, ${moving} lot(s) moved as they are. `
      + `"${eventLabel(preview.from)}" is then removed; its name keeps pointing at the merged sale.`;
    if (!window.confirm(msg)) return;
    setBusy(true); setError(null);
    try {
      const res = await api('/api/store/sales/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, into, apply: true,
          pairs: chosen.map((p) => ({ keep: p.keep.id, drop: p.drop.id })),
        }),
      });
      onDone(`Merged: ${res.merged_pairs} pair(s) combined, ${res.moved} lot(s) moved.`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold flex items-center gap-2"><GitMerge size={16} /> Merge two events</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-slate-400">Merge</span>
        <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">— event to remove —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{eventLabel(e)} ({e.lots})</option>)}
        </select>
        <span className="text-sm text-slate-400">into</span>
        <select className={inputCls} value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">— event to keep —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{eventLabel(e)} ({e.lots})</option>)}
        </select>
        <button onClick={() => { setFrom(into); setInto(from); }} title="Swap"
          className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}><ArrowRightLeft size={14} /></button>
      </div>
      {error && <Note onClose={() => setError(null)}>{error}</Note>}
      {busy && !preview && <p className="text-slate-400 text-sm">Matching lots…</p>}
      {preview && (
        <>
          <p className="text-sm text-slate-300 mb-2">
            {preview.pairs.length} lot(s) look like the same car in both events
            {preview.pairs.some((p) => p.confidence !== 'high') && (
              <span className="text-amber-300"> — {preview.pairs.filter((p) => p.confidence !== 'high').length} need a check and start unticked</span>
            )}.
            {' '}{preview.move.length} lot(s) are only in the event being removed and move as they are;
            {' '}{preview.into_only} are only in the event being kept.
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Ticked pairs become one lot: the kept lot takes whatever it lacks (result, estimate, year…) from the other.
            An unticked pair is not combined; its lot moves across as a separate lot.
          </p>
          {preview.pairs.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700 mb-3 max-h-[28rem] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-800 border-b border-slate-700 sticky top-0">
                  <tr><Th> </Th><Th>Kept lot ({eventLabel(preview.into)})</Th><Th>Duplicate ({eventLabel(preview.from)})</Th><Th>Match</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {preview.pairs.map((p) => (
                    <tr key={p.drop.id} className={p.confidence === 'high' ? '' : 'bg-amber-900/10'}>
                      <Td><input type="checkbox" checked={Boolean(ticked[p.drop.id])}
                        onChange={(e) => setTicked({ ...ticked, [p.drop.id]: e.target.checked })} /></Td>
                      <Td><LotCell lot={p.keep} /></Td>
                      <Td><LotCell lot={p.drop} /></Td>
                      <Td className="whitespace-nowrap text-xs">
                        <span className={p.confidence === 'high' ? 'text-emerald-300' : 'text-amber-300'}>
                          {p.via === 'lot' ? 'same lot #' : `${Math.round(p.score * 100)}%`}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.move.length > 0 && (
            <details className="mb-3">
              <summary className="text-sm text-slate-300 cursor-pointer">{preview.move.length} lot(s) that move across unchanged</summary>
              <ul className="mt-2 text-xs text-slate-400 space-y-1 max-h-48 overflow-y-auto">
                {preview.move.map((l) => <li key={l.id}>{l.title} — {l.status}{l.outcome ? ` · ${l.outcome}` : ''}</li>)}
              </ul>
            </details>
          )}
          <button onClick={apply} disabled={busy}
            className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            <GitMerge size={14} /> {busy ? 'Merging…' : `Merge: combine ${chosen.length}, move ${moving}`}
          </button>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------- estimates
function EstimatesPanel({ event, onDone, onClose }) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const read = async () => {
    setBusy('Reading catalogue…'); setError(null); setNote(null); setPreview(null);
    try {
      const isUrl = /^https?:\/\//i.test(input.trim());
      const ex = await api('/api/store/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'estimate', [isUrl ? 'url' : 'text']: input.trim() }),
      });
      if (ex.note) setNote(ex.note);
      if (!ex.lots?.length) {
        setError('No lots found. Catalogue pages often load their lots with JavaScript — open the page, '
          + 'let it render, then paste the visible text instead of the URL.');
        setBusy(null); return;
      }
      setBusy('Matching lots…');
      const data = await api('/api/store/sales/estimates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: event.id, lots: ex.lots }),
      });
      setPreview(data);
      setTicked(Object.fromEntries(data.matches.map((m) => [m.listing.id, m.confidence === 'high' && !m.has_estimate])));
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  const chosen = preview ? preview.matches.filter((m) => ticked[m.listing.id]) : [];

  const apply = async () => {
    if (!chosen.length) return;
    setBusy('Saving estimates…'); setError(null);
    try {
      const res = await api('/api/store/sales/estimates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id, apply: true, sale_date: event.sale_date || undefined,
          accept: chosen.map((m) => ({
            listing_id: m.listing.id,
            estimate_low: m.catalogue.estimate_low,
            estimate_high: m.catalogue.estimate_high,
            currency: m.catalogue.currency,
          })),
        }),
      });
      onDone(`Estimates added to ${res.updated} lot(s) in ${eventLabel(event)}.`);
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white font-semibold flex items-center gap-2"><Tag size={16} /> Add catalogue estimates · {eventLabel(event)}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        {event.lots} lot(s) in this sale, {event.with_estimate} with an estimate. Paste the catalogue or results page URL
        (or its text). Estimates are written onto the lots already here. Nothing new is created, so lots that came from
        the game are not duplicated. Each estimate is saved in its lot&apos;s own currency, converted at the sale-date rate
        when the catalogue quotes another.
      </p>
      <div className="flex gap-2 mb-3">
        <textarea className={`${inputCls} flex-1 h-20 font-mono`} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="https://… catalogue page, or pasted page text" />
        <button onClick={read} disabled={!input.trim() || Boolean(busy)}
          className={`${btn} self-start bg-blue-600 hover:bg-blue-700 text-white`}>
          <Sparkles size={14} /> {busy || 'Read catalogue'}
        </button>
      </div>
      {error && <Note onClose={() => setError(null)}>{error}</Note>}
      {note && <p className="text-amber-300 text-xs mb-2">{note}</p>}
      {preview && (
        <>
          <p className="text-sm text-slate-300 mb-2">
            {preview.matches.length} catalogue lot(s) matched lots in this sale.
            {' '}{preview.unmatched_catalogue.length} catalogue lot(s) aren&apos;t in the store for this sale
            {preview.catalogue_without_estimate ? `, ${preview.catalogue_without_estimate} had no estimate` : ''};
            {' '}{preview.unmatched_lots} lot(s) here found no catalogue match.
            {' '}Lots that already have an estimate, or whose match needs a check, start unticked.
          </p>
          {preview.matches.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700 mb-3 max-h-[28rem] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-800 border-b border-slate-700 sticky top-0">
                  <tr><Th> </Th><Th>Lot in the store</Th><Th>Catalogue lot</Th><Th>Estimate</Th><Th>Match</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {preview.matches.map((m) => (
                    <tr key={m.listing.id} className={m.confidence === 'high' ? '' : 'bg-amber-900/10'}>
                      <Td><input type="checkbox" checked={Boolean(ticked[m.listing.id])}
                        onChange={(e) => setTicked({ ...ticked, [m.listing.id]: e.target.checked })} /></Td>
                      <Td><LotCell lot={m.listing} /></Td>
                      <Td>
                        {m.catalogue.lot ? <span className="text-slate-400">#{m.catalogue.lot} </span> : null}
                        {[m.catalogue.year, m.catalogue.make, m.catalogue.model, m.catalogue.trim].filter(Boolean).join(' ')}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {fmtEst(m.catalogue.estimate_low, m.catalogue.estimate_high, m.catalogue.currency)}
                        {m.has_estimate && <div className="text-xs text-amber-300">replaces current estimate</div>}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        <span className={m.confidence === 'high' ? 'text-emerald-300' : 'text-amber-300'}>
                          {m.via === 'lot' ? 'same lot #' : `${Math.round(m.score * 100)}%`}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.unmatched_catalogue.length > 0 && (
            <details className="mb-3">
              <summary className="text-sm text-slate-300 cursor-pointer">
                {preview.unmatched_catalogue.length} catalogue lot(s) with no lot in this sale
              </summary>
              <p className="text-xs text-slate-400 mt-1">
                Usually cars the game never listed. Add them through Live Entry if the sale should be complete.
              </p>
              <ul className="mt-2 text-xs text-slate-400 space-y-1 max-h-48 overflow-y-auto">
                {preview.unmatched_catalogue.map((l, i) => (
                  <li key={`${l.lot}-${i}`}>
                    {l.lot ? `#${l.lot} ` : ''}{[l.year, l.make, l.model].filter(Boolean).join(' ')} — {fmtEst(l.estimate_low, l.estimate_high, l.currency)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button onClick={apply} disabled={!chosen.length || Boolean(busy)}
            className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            <Tag size={14} /> {busy === 'Saving estimates…' ? busy : `Save estimates for ${chosen.length} lot(s)`}
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- edit
function EditRow({ event, onDone, onCancel }) {
  const [f, setF] = useState({
    house: event.house || '', name: event.name || '', location: event.location || '',
    starts_on: event.starts_on || event.first_date || '', ends_on: event.ends_on || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api('/api/store/sales', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id, ...f }),
      });
      onDone(`Saved ${f.house} · ${f.name}.`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <tr className="bg-slate-900/60">
      <Td colSpan={9}>
        <div className="flex flex-wrap items-end gap-2">
          {[['house', 'House', 'w-40'], ['name', 'Sale name', 'w-56'], ['location', 'Location', 'w-40']].map(([k, label, w]) => (
            <label key={k} className="text-xs text-slate-400">{label}
              <input className={`${inputCls} ${w} block mt-1`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </label>
          ))}
          <label className="text-xs text-slate-400">First day
            <input type="date" className={`${inputCls} block mt-1`} value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
          </label>
          <label className="text-xs text-slate-400">Last day
            <input type="date" className={`${inputCls} block mt-1`} value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
          </label>
          <button onClick={save} disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>{busy ? 'Saving…' : 'Save'}</button>
          <button onClick={onCancel} className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}>Cancel</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          The first day is the sale date the index uses. The old name keeps pointing here, so the game can keep sending it.
        </p>
        {error && <div className="mt-2"><Note onClose={() => setError(null)}>{error}</Note></div>}
      </Td>
    </tr>
  );
}

// ------------------------------------------------------------------- shell
export default function SalesPanel() {
  const [rows, setRows] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [panel, setPanel] = useState(null); // { kind: 'merge', from, into } | { kind: 'estimates', event }
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api('/api/store/sales');
      setRows(data.rows || []);
      setSuggestions(data.suggestions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const finish = (msg) => { setDone(msg); setPanel(null); setEditing(null); load(); };
  const openPanel = (p) => { setDone(null); setPanel(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const totals = useMemo(() => rows.reduce((t, r) => ({
    ended: t.ended + r.ended, est: t.est + r.with_estimate, apex: t.apex + r.apex,
  }), { ended: 0, est: 0, apex: 0 }), [rows]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-400 text-sm">
          Live-auction sales in the store: {rows.length} events, {totals.ended} finished lots,
          {' '}{totals.est} with an estimate, {totals.apex} apex (low estimate ≥ $500K).
          {' '}The index can only rank lots with estimates.
        </p>
        <button onClick={load} className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <Note onClose={() => setError(null)}>{error}</Note>}
      {done && <Note kind="ok" onClose={() => setDone(null)}>{done}</Note>}

      {panel?.kind === 'merge' && (
        <MergePanel key={`${panel.from}-${panel.into}`} events={rows} initial={panel} onDone={finish} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'estimates' && (
        <EstimatesPanel key={panel.event.id} event={panel.event} onDone={finish} onClose={() => setPanel(null)} />
      )}

      {suggestions.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-800/50 rounded-lg p-3 mb-4">
          <p className="text-amber-200 text-sm font-medium mb-2">Possibly the same sale entered twice</p>
          <ul className="space-y-1.5">
            {suggestions.filter((s) => byId[s.from] && byId[s.into]).map((s) => (
              <li key={`${s.from}-${s.into}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300">
                  {eventLabel(byId[s.from])} <span className="text-slate-500">({byId[s.from].lots} lots, {byId[s.from].sale_date || 'no date'})</span>
                  {' → '}
                  {eventLabel(byId[s.into])} <span className="text-slate-500">({byId[s.into].lots} lots, {byId[s.into].sale_date || 'no date'})</span>
                </span>
                <button onClick={() => openPanel({ kind: 'merge', from: s.from, into: s.into })}
                  className={`${btn} bg-slate-700 hover:bg-slate-600 text-white shrink-0`}><GitMerge size={14} /> Review merge</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full bg-slate-800">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr>
              <Th>Sale</Th><Th>Date</Th><Th className="text-right">Lots</Th><Th className="text-right">Ended</Th>
              <Th className="text-right">Sold</Th><Th className="text-right">Est.</Th><Th className="text-right">Apex</Th>
              <Th className="text-right">From game</Th><Th> </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr className="hover:bg-slate-700/40">
                  <Td>
                    <div>{eventLabel(r)}</div>
                    {(r.house || '').toLowerCase() === (r.name || '').toLowerCase() && (
                      <div className="text-xs text-slate-500">no house set</div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.sale_date || '—'}
                    {!r.starts_on && r.sale_date && <div className="text-xs text-slate-500">from lot dates</div>}
                  </Td>
                  <Td className="text-right">{r.lots}</Td>
                  <Td className="text-right">{r.ended}</Td>
                  <Td className="text-right">{r.sold}</Td>
                  <Td className={`text-right ${r.with_estimate === 0 && r.ended > 0 ? 'text-amber-300' : ''}`}>{r.with_estimate}</Td>
                  <Td className="text-right">{r.apex}</Td>
                  <Td className="text-right">{r.from_game}</Td>
                  <Td className="whitespace-nowrap">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditing(editing === r.id ? null : r.id)} title="Edit name, house, dates"
                        className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}><Pencil size={13} /></button>
                      <button onClick={() => openPanel({ kind: 'merge', from: r.id, into: '' })} title="Merge into another event"
                        className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}><GitMerge size={13} /></button>
                      <button onClick={() => openPanel({ kind: 'estimates', event: r })} title="Add catalogue estimates"
                        className={`${btn} bg-slate-700 hover:bg-slate-600 text-white`}><Tag size={13} /></button>
                    </div>
                  </Td>
                </tr>
                {editing === r.id && <EditRow event={r} onDone={finish} onCancel={() => setEditing(null)} />}
              </React.Fragment>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td colSpan={9} className="text-slate-500 py-6 text-center">No live-auction events in the store yet.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
