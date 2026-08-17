'use client'
import React, { useState, useRef, useCallback } from 'react';
import { DatabaseBackup, Play, Square, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '../lib/adminApi';

/**
 * Backfill from game — drives /api/store/reconcile across batches.
 *
 * The route is deliberately bounded: each call works a slice and returns a
 * cursor rather than running until the platform kills it. This component owns
 * the loop, so a 10k-row backfill is a progress bar here instead of a timeout
 * there. Stopping is always safe — the upsert is keyed the same way the live
 * mirror keys it, so a half-finished run just resumes on the next click.
 */

const num = (v) => Number(v || 0).toLocaleString('en-US');

export default function ReconcilePanel() {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState(null);       // 'dry' | 'live'
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [samples, setSamples] = useState([]);
  const stopRef = useRef(false);

  const run = useCallback(async (dryRun) => {
    setRunning(true);
    setMode(dryRun ? 'dry' : 'live');
    setError(null);
    setSamples([]);
    stopRef.current = false;

    const totals = { scanned: 0, mirrored: 0, already_present: 0, unkeyable: 0, failed_batches: 0, calls: 0 };
    let cursor = null;

    try {
      for (;;) {
        const qs = new URLSearchParams({ dry_run: String(dryRun), page: '300', budget_ms: '20000' });
        if (cursor) qs.set('cursor', cursor);
        const d = await api(`/api/store/reconcile?${qs.toString()}`, { method: 'POST' });

        totals.scanned += d.scanned || 0;
        totals.mirrored += d.mirrored || 0;
        totals.already_present += d.already_present || 0;
        totals.unkeyable += d.unkeyable || 0;
        totals.failed_batches += d.failed_batches || 0;
        totals.calls += 1;
        setProgress({ ...totals, done: d.done });
        if (d.samples?.length) setSamples((s) => (s.length ? s : d.samples));

        if (d.done || !d.next_cursor) break;
        if (stopRef.current) { setProgress({ ...totals, done: false, stopped: true }); break; }
        cursor = d.next_cursor;
      }
    } catch (e) {
      setError(e.message);
    }
    setRunning(false);
  }, []);

  const p = progress;

  return (
    <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[280px]">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <DatabaseBackup size={15} className="text-blue-400" /> Backfill from game
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            The store only ever receives a listing when something writes one — so anything that settled
            before the mirror was switched on, or while it was unconfigured, or that the finalizer never
            resolved, is simply absent. This walks the game&rsquo;s <code>auctions</code> table and
            upserts whatever is missing. Idempotent, and safe to stop and resume.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {!running && (
            <>
              <button
                onClick={() => run(true)}
                className="flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                <Play size={13} /> Dry run
              </button>
              <button
                onClick={() => run(false)}
                className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                <DatabaseBackup size={13} /> Run backfill
              </button>
            </>
          )}
          {running && (
            <button
              onClick={() => { stopRef.current = true; }}
              className="flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
            >
              <Square size={13} /> Stop after this batch
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded border border-red-800 bg-red-900/30 p-2.5 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {p && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Scanned', num(p.scanned), 'game rows read'],
              [mode === 'dry' ? 'Would mirror' : 'Mirrored', num(p.mirrored), mode === 'dry' ? 'missing from store' : 'written to store'],
              ['Already present', num(p.already_present), 'skipped'],
              ['Unkeyable', num(p.unkeyable), 'no id and no url'],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded border border-slate-700 bg-slate-900/50 p-2.5">
                <div className="text-[11px] text-slate-400">{label}</div>
                <div className="font-mono text-lg text-white">{value}</div>
                <div className="text-[10px] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs">
            {running && <span className="text-slate-400">Working… batch {p.calls}</span>}
            {!running && p.done && (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle size={13} />
                {mode === 'dry'
                  ? `Dry run complete — ${num(p.mirrored)} listing(s) missing from the store.`
                  : `Backfill complete — ${num(p.mirrored)} listing(s) added.`}
              </span>
            )}
            {!running && p.stopped && <span className="text-amber-400">Stopped — click again to resume.</span>}
            {p.failed_batches > 0 && (
              <span className="text-amber-400">{p.failed_batches} batch(es) failed to write.</span>
            )}
          </div>

          {mode === 'dry' && !running && p.done && p.mirrored > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Nothing was written. Click <strong className="text-slate-200">Run backfill</strong> to apply.
            </p>
          )}

          {samples.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
                Sample of missing listings
              </summary>
              <div className="mt-1.5 max-h-40 overflow-y-auto rounded border border-slate-700 bg-slate-900/50 p-2">
                {samples.map((s) => (
                  <div key={`${s.source}:${s.id}`} className="font-mono text-[11px] text-slate-400">
                    <span className="text-slate-500">{s.source}</span> {s.id}
                    {s.title ? ` — ${String(s.title).slice(0, 60)}` : ''}
                    {s.outcome ? ` (${s.outcome})` : ''}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
