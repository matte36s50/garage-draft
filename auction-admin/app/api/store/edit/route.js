import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../lib/canonicalStore';

/**
 * POST /api/store/edit — manually correct a single canonical listing.
 *
 * The store's one door (auction_upsert_listing with entered_by='manual')
 * records every column a human touches into `manual_fields`, so later scraper
 * writes can't clobber the correction. Manual writes also clear needs_review
 * unless the body explicitly sets it.
 *
 * Body:
 *   { source_id, source_listing_id,          // identifies the row to edit
 *     outcome?, price?, current_bid?,         // the common corrections
 *     year?, make?, model?, trim?, mileage?,
 *     bid_count?, views?, watchers?, comments?, ended_at?,
 *     needs_review? }                         // omit to auto-resolve the flag
 *
 * Outcome/price coupling (mirrors Live Entry + the store's RNM rule):
 *   - sold            -> a positive price is required; current_bid is dropped.
 *   - reserve_not_met -> price is NOT sent, so the upsert clears any stale
 *                        "sold" price; the high bid goes to current_bid.
 *   - withdrawn / unknown -> neither price nor current_bid is sent.
 */

const OUTCOMES = new Set(['sold', 'reserve_not_met', 'withdrawn', 'unknown']);

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
};

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sourceId = body.source_id;
  const listingId = body.source_listing_id;
  if (!sourceId || !listingId) {
    return NextResponse.json(
      { error: 'source_id and source_listing_id are required' },
      { status: 400 }
    );
  }

  const payload = {};

  // --- Outcome + the price/current_bid coupling -----------------------------
  if (body.outcome !== undefined && body.outcome !== '') {
    const outcome = String(body.outcome);
    if (!OUTCOMES.has(outcome)) {
      return NextResponse.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 });
    }
    payload.outcome = outcome;

    if (outcome === 'sold') {
      const price = numOrNull(body.price);
      if (price == null || price <= 0) {
        return NextResponse.json({ error: 'A sold listing needs a positive price' }, { status: 400 });
      }
      payload.price = price;
      // A sold row has no "high bid — reserve not met" amount.
      payload.current_bid = null;
    } else if (outcome === 'reserve_not_met') {
      // Deliberately do NOT send price: the upsert clears the stale sold-price
      // for an RNM outcome. The high bid, if given, lands in current_bid.
      const bid = numOrNull(body.current_bid ?? body.price);
      if (bid != null) payload.current_bid = bid;
    }
    // withdrawn / unknown: leave price and current_bid untouched here unless
    // the caller sends them explicitly below.
  } else {
    // No outcome change — still allow direct price / current_bid edits.
    if (body.price !== undefined) payload.price = numOrNull(body.price);
    if (body.current_bid !== undefined) payload.current_bid = numOrNull(body.current_bid);
  }

  // --- Descriptive + engagement fields (optional) ---------------------------
  if (body.year !== undefined) payload.year = intOrNull(body.year);
  if (body.make !== undefined) payload.make = body.make || undefined;
  if (body.model !== undefined) payload.model = body.model || undefined;
  if (body.trim !== undefined) payload.trim = body.trim || undefined;
  if (body.mileage !== undefined) payload.mileage = intOrNull(body.mileage);
  if (body.bid_count !== undefined) payload.bid_count = intOrNull(body.bid_count);
  if (body.views !== undefined) payload.views = intOrNull(body.views);
  if (body.watchers !== undefined) payload.watchers = intOrNull(body.watchers);
  if (body.comments !== undefined) payload.comments = intOrNull(body.comments);
  if (body.ended_at) payload.ended_at = body.ended_at;

  // needs_review: explicit wins; otherwise the manual write auto-resolves it.
  if (body.needs_review !== undefined) payload.needs_review = Boolean(body.needs_review);

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_upsert_listing', {
    p_source_id: sourceId,
    p_source_listing_id: listingId,
    p_payload: payload,
    p_entered_by: 'manual',
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({ success: true, id: res.data, payload });
}
