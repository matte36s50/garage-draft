import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../../lib/canonicalStore';
import { fetchEvent, fetchEventLots, lotSummary, rpcErrorMessage } from '../../../../../lib/storeSales';
import { matchLots } from '../../../../../lib/lotMatch';
import { crossRate } from '../../../../../lib/fx';

/**
 * POST /api/store/sales/estimates — attach catalogue estimates to lots an
 * event already holds.
 *
 * Re-importing a sale through Live Entry creates new `<event>-lot-<n>` rows,
 * so for lots that came from the game (`manual_…` ids) it would duplicate
 * every car. This writes only estimate_low / estimate_high onto the existing
 * rows instead.
 *
 * Body { event_id, lots }            -> preview: catalogue lots (from
 *                                       /api/store/extract, mode 'estimate')
 *                                       matched to the event's lots.
 * Body { event_id, accept, apply: true, sale_date? }
 *                                    -> write. accept = [{ listing_id,
 *                                       estimate_low, estimate_high, currency }];
 *                                       estimates are written in each lot's own
 *                                       currency (the one its price is in),
 *                                       converted at the sale-date ECB rate
 *                                       when the catalogue quotes another.
 * Writes go through auction_upsert_listings as manual edits, so the game
 * mirror can never overwrite them; each row's needs_review is passed through
 * unchanged so unbucketed lots stay in the review queue.
 */

const MAX_LOTS = 1500;
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')));

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.event_id) return NextResponse.json({ error: 'event_id is required' }, { status: 400 });

  const [ev, lots] = await Promise.all([fetchEvent(body.event_id), fetchEventLots(body.event_id)]);
  for (const r of [ev, lots]) {
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  }

  if (body.apply) return apply(body, ev.event, lots.rows);

  const catalogue = (Array.isArray(body.lots) ? body.lots : []).slice(0, MAX_LOTS)
    .map((l) => ({
      lot: l.lot ?? null, year: l.year ?? null, make: l.make ?? null, model: l.model ?? null,
      trim: l.trim ?? null, currency: (l.currency || 'USD').toUpperCase(),
      estimate_low: num(l.estimate_low), estimate_high: num(l.estimate_high),
    }));
  const withEstimate = catalogue.filter((l) => l.estimate_low != null || l.estimate_high != null);

  const m = matchLots(lots.rows, withEstimate);
  return NextResponse.json({
    event: ev.event,
    matches: m.matches.map((x) => ({
      listing: lotSummary(x.existing),
      catalogue: x.incoming,
      score: x.score,
      via: x.via,
      confidence: x.confidence,
      has_estimate: x.existing.estimate_low != null || x.existing.estimate_high != null,
    })),
    unmatched_catalogue: m.unmatchedIncoming,
    unmatched_lots: m.unmatchedExisting.length,
    catalogue_without_estimate: catalogue.length - withEstimate.length,
  });
}

async function apply(body, event, eventLots) {
  const byId = new Map(eventLots.map((l) => [l.id, l]));
  const accept = Array.isArray(body.accept) ? body.accept : [];
  if (accept.length === 0) return NextResponse.json({ error: 'Nothing to apply' }, { status: 400 });

  const items = [];
  for (const a of accept) {
    const row = byId.get(a?.listing_id);
    if (!row) {
      return NextResponse.json({ error: `Listing ${a?.listing_id} is not in this event` }, { status: 400 });
    }
    let low = num(a.estimate_low);
    let high = num(a.estimate_high);
    if ((low != null && !(low > 0)) || (high != null && !(high > 0)) || (low == null && high == null)) {
      return NextResponse.json({ error: `Bad estimate for ${row.raw_title || row.id}` }, { status: 400 });
    }
    if (low != null && high != null && high < low) [low, high] = [high, low];

    // Estimates are stored in the lot's own currency, next to its price, so a
    // lot priced in EUR gets EUR estimates even from a USD-quoted catalogue.
    const from = String(a.currency || 'USD').toUpperCase();
    const to = String(row.currency || 'USD').toUpperCase();
    if (from !== to) {
      const date = body.sale_date || event.starts_on
        || String(row.ended_at || row.ends_at || '').slice(0, 10) || null;
      let rate;
      try {
        rate = await crossRate(from, to, date);
      } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 502 });
      }
      if (low != null) low = Math.round(low * rate * 100) / 100;
      if (high != null) high = Math.round(high * rate * 100) / 100;
    }

    const payload = { needs_review: Boolean(row.needs_review) };
    if (low != null) payload.estimate_low = low;
    if (high != null) payload.estimate_high = high;
    items.push({
      source_id: row.source_id,
      source_listing_id: row.source_listing_id,
      entered_by: 'manual',
      payload,
    });
  }

  const res = await canonicalRpc('auction_upsert_listings', { p_batch: items });
  if (!res.ok) return NextResponse.json({ error: rpcErrorMessage(res) }, { status: res.status >= 500 ? res.status : 400 });
  return NextResponse.json({ success: true, updated: items.length });
}
