import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import {
  toCanonicalItem, canonicalUpsertListings, canonicalGet, canonicalConfigured,
} from '../../../../lib/canonicalStore';

/**
 * POST /api/store/reconcile — backfill the canonical store from the game's
 * `auctions` table.
 *
 * WHY: the canonical store is a write-triggered mirror with no reconciliation.
 * A listing only lands there if it happened to pass through finalize-auctions,
 * /api/scrape/*, or sync-live while CANONICAL_SUPABASE_* was configured. Three
 * things therefore go missing silently:
 *
 *   1. Anything that settled before the dual-write shim was switched on.
 *   2. Anything written while the canonical env was unset — canonicalUpsertListings
 *      returns { skipped: true } by design so mirroring can never break the
 *      game's write path, but there is no queue and no replay.
 *   3. Anything the finalizer never resolved to sold/no_sale; those rows are
 *      never pushed, and once the attempt cap is hit they stop being retried.
 *
 * This route closes all three by walking `auctions` and upserting whatever the
 * store is missing, keyed exactly as the live mirror keys it (toCanonicalItem),
 * so it is idempotent and safe to re-run.
 *
 * Bounded and resumable, like the finalizer: each call works a slice and hands
 * back a cursor rather than running until the platform kills it. The admin UI
 * loops until done; a cron can call it with Bearer CRON_SECRET.
 *
 * Params (query or JSON body):
 *   dry_run=true   report what WOULD be mirrored, write nothing. Do this first.
 *   cursor=<id>    resume after this auction_id
 *   page=300       game rows per fetch (max 1000)
 *   budget_ms=20000  stop starting new pages after this much elapsed
 *   force=true     re-upsert rows already present (repairs a bad earlier mirror)
 *   since=<epoch>  only rows with timestamp_end >= this
 */

// Matches the other long-running routes (store/extract, review/suggest). The
// per-call budget below stays well under this — the point of the cursor is that
// the platform limit is never what stops a run.
export const maxDuration = 300;

export async function GET(request) { return reconcile(request); }
export async function POST(request) { return reconcile(request); }

/** PostgREST in.("a","b") — BaT slugs and manual_ ids are safe, quote anyway. */
const inList = (values) => `(${values.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;

/**
 * Which of these items the canonical store already has.
 * Chunked: 300 ids in one in.() makes a URL long enough to be refused.
 */
async function existingKeys(items) {
  const found = new Set();
  const CHUNK = 75;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const ids = [...new Set(slice.map((it) => it.source_listing_id))];
    if (ids.length === 0) continue;
    const res = await canonicalGet(
      `auction_listings_all?select=source_id,source_listing_id`
      + `&source_listing_id=in.${encodeURIComponent(inList(ids))}&limit=${ids.length * 2}`
    );
    // A failed existence probe must not be read as "nothing exists" — that would
    // re-upsert the whole store. Surface it and let the caller stop.
    if (!res.ok) throw new Error(`Existence check failed: ${res.error}`);
    res.rows.forEach((r) => found.add(`${r.source_id}:${r.source_listing_id}`));
  }
  return found;
}

async function reconcile(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  if (!canonicalConfigured()) {
    return NextResponse.json(
      { error: 'Canonical store not configured (set CANONICAL_SUPABASE_URL and CANONICAL_SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  let body = {};
  if (request.method === 'POST') {
    body = await request.json().catch(() => ({}));
  }
  const param = (k) => (body[k] !== undefined ? body[k] : url.searchParams.get(k));

  const dryRun = String(param('dry_run')) === 'true';
  const force = String(param('force')) === 'true';
  const cursor = param('cursor') || null;
  const since = param('since') != null && param('since') !== '' ? Number(param('since')) : null;
  const page = Math.min(Math.max(parseInt(param('page') || '300', 10) || 300, 25), 1000);
  // Default is short on purpose: the admin UI loops, and frequent returns keep
  // the progress readout moving. A cron can raise it toward the 300s ceiling.
  const budgetMs = Math.min(Math.max(parseInt(param('budget_ms') || '20000', 10) || 20000, 3000), 240000);

  const started = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const stats = {
    scanned: 0,        // game rows read
    unkeyable: 0,      // no auction_id and no url — cannot be mirrored
    already_present: 0,
    mirrored: 0,
    failed_batches: 0,
  };
  const samples = [];
  let nextCursor = cursor;
  let done = false;

  try {
    // Keyset paging on auction_id: stable, resumable, and unaffected by rows
    // being updated mid-run the way an OFFSET would be.
    for (;;) {
      let q = supabase
        .from('auctions')
        .select('*')
        .order('auction_id', { ascending: true })
        .limit(page);
      if (nextCursor) q = q.gt('auction_id', nextCursor);
      if (since != null && Number.isFinite(since)) q = q.gte('timestamp_end', since);

      const { data, error } = await q;
      if (error) {
        return NextResponse.json({ error: `Game DB read failed: ${error.message}` }, { status: 500 });
      }
      if (!data || data.length === 0) { done = true; break; }

      stats.scanned += data.length;
      nextCursor = data[data.length - 1].auction_id;

      const items = [];
      for (const row of data) {
        const item = toCanonicalItem(row);
        if (!item) { stats.unkeyable += 1; continue; }
        items.push(item);
      }

      let toWrite = items;
      if (!force && items.length > 0) {
        const have = await existingKeys(items);
        toWrite = items.filter((it) => !have.has(`${it.source_id}:${it.source_listing_id}`));
        stats.already_present += items.length - toWrite.length;
      }

      for (const it of toWrite) {
        if (samples.length < 15) {
          samples.push({
            source: it.source_id,
            id: it.source_listing_id,
            title: it.payload.raw_title || null,
            outcome: it.payload.outcome || it.payload.status || null,
          });
        }
      }

      if (!dryRun && toWrite.length > 0) {
        // Chunked so one oversized RPC body can't fail a whole page.
        const CHUNK = 200;
        for (let i = 0; i < toWrite.length; i += CHUNK) {
          const res = await canonicalUpsertListings(toWrite.slice(i, i + CHUNK));
          if (res.ok) stats.mirrored += res.mirrored;
          else stats.failed_batches += 1;
        }
      } else if (dryRun) {
        stats.mirrored += toWrite.length; // would-be count
      }

      if (data.length < page) { done = true; break; }
      if (Date.now() - started > budgetMs) break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e.message, partial: stats, next_cursor: nextCursor },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    dry_run: dryRun,
    ...stats,
    next_cursor: done ? null : nextCursor,
    done,
    elapsed_ms: Date.now() - started,
    samples,
  });
}
