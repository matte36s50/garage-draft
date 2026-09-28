import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../../lib/canonicalStore';
import { HOUSES, buildIngestItems } from '../../../../../lib/catalogueWatch';
import { rpcErrorMessage } from '../../../../../lib/storeSales';

/**
 * The catalogue watch's door into the store (scripts/catalogue-watch.mjs).
 *
 * POST — lots the extractor read from one sale's catalogue:
 *   { house, event: { name, location, starts_on, ends_on }, catalogue_url,
 *     mode: 'estimate' | 'result', lots: [...] }
 * Written through auction_upsert_listings as entered_by 'scraper', keyed by
 * each lot's own page (lib/catalogueWatch.js), so a pass updates the rows the
 * last one wrote and never overrides a field corrected by hand.
 *
 * GET — watched sales that are over but still hold upcoming lots: the
 * results passes still owed. The job keeps its own record too; this is what
 * it falls back on when that record is lost.
 *
 * Auth: admin session or `Authorization: Bearer <CRON_SECRET>`.
 */

const BATCH = 200;
const MAX_LOTS = 3000;

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { house, event, catalogue_url: catalogueUrl, mode, lots } = body || {};
  if (!HOUSES[house]) return NextResponse.json({ error: `Unknown house '${house}'` }, { status: 400 });
  if (!['estimate', 'result'].includes(mode)) return NextResponse.json({ error: "mode must be 'estimate' or 'result'" }, { status: 400 });
  if (!Array.isArray(lots) || lots.length > MAX_LOTS) {
    return NextResponse.json({ error: `lots must be an array of at most ${MAX_LOTS}` }, { status: 400 });
  }

  let built;
  try {
    built = buildIngestItems({
      houseId: house, event, catalogueUrl, mode, lots, today: new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  let written = 0;
  for (let i = 0; i < built.items.length; i += BATCH) {
    const res = await canonicalRpc('auction_upsert_listings', { p_batch: built.items.slice(i, i + BATCH) });
    if (!res.ok) {
      return NextResponse.json(
        { error: rpcErrorMessage(res), written },
        { status: res.status >= 500 ? res.status : 400 }
      );
    }
    written += Math.min(BATCH, built.items.length - i);
  }

  return NextResponse.json({
    success: true,
    written,
    skipped: built.skipped.map(({ lot, reason }) => ({
      lot: [lot.lot, lot.year, lot.make, lot.model].filter(Boolean).join(' ') || lot.lot_url || '?',
      reason,
    })),
  });
}

export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const today = new Date().toISOString().slice(0, 10);
  const res = await canonicalGet(
    'auction_listings_all?select=ends_at,catalogue_url:raw_payload->>catalogue_url,house:raw_payload->>house_id'
    + `&source_id=eq.manual&source_listing_id=like.cw-*&status=eq.upcoming&ends_at=lt.${today}&limit=10000`
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const sales = new Map();
  for (const row of res.rows) {
    if (!row.catalogue_url || !HOUSES[row.house]) continue;
    const day = String(row.ends_at || '').slice(0, 10);
    const s = sales.get(row.catalogue_url) || { catalogue_url: row.catalogue_url, house: row.house, starts_on: day, upcoming_lots: 0 };
    s.upcoming_lots += 1;
    if (day && day < s.starts_on) s.starts_on = day;
    sales.set(row.catalogue_url, s);
  }
  return NextResponse.json({ awaiting_results: [...sales.values()] });
}
