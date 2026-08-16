import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../lib/canonicalStore';
import { getUsdRate } from '../../../../lib/fx';
import {
  computePremium, normalizeCategory, normalizeFeeSchedule, tierSetForCategory,
} from '../../../../lib/feeSchedule';

/**
 * Manual live-auction lot entry (unified panel) — two-phase workflow:
 *
 *   Phase 1 (before the sale): POST with mode 'estimate' — lot + catalog
 *   estimate range, saved as status 'upcoming'.
 *   Phase 2 (after the sale):  POST with mode 'result' (default) — outcome +
 *   hammer price. The lot id is stable (<event>-lot-<n>), so this UPDATES the
 *   phase-1 row: estimates are retained, status flips to 'ended'.
 *
 * GET ?event=<name> lists that event's lots (for the "update with results"
 * pass in the UI).
 *
 * Buyer premium: send either a flat `buyer_premium_pct` or a `fee_schedule`
 * (see lib/feeSchedule.js) for houses that publish a sliding scale — plus an
 * optional `lot_category` ('cars', 'motorcycles', 'automobilia') to pick the
 * right row of their fee table. The premium is computed here, in the catalog
 * currency, before the FX conversion below; the store gets price_all_in, the
 * blended rate in buyer_premium_pct, and the schedule itself for audit.
 */

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const eventName = new URL(request.url).searchParams.get('event');
  if (!eventName) return NextResponse.json({ error: 'event query param required' }, { status: 400 });

  const ev = await canonicalGet(
    `auction_events_all?select=id,name,house,location&name=eq.${encodeURIComponent(eventName)}&limit=1`
  );
  if (!ev.ok) return NextResponse.json({ error: ev.error }, { status: ev.status });
  if (!ev.rows.length) return NextResponse.json({ event: null, rows: [] });

  const res = await canonicalGet(
    `auction_listings_all?select=id,source_listing_id,raw_title,year,make,model,trim,status,outcome,price,price_all_in,currency,estimate_low,estimate_high,buyer_premium_pct&event_id=eq.${ev.rows[0].id}&order=source_listing_id.asc&limit=1000`
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  // Best-effort: recover the fee schedule from a lot that was entered with one
  // so the UI can reload the event's tiers. A store that can't answer the
  // JSON-path query simply reports no schedule — never a failed lot list.
  let feeSchedule = null;
  const fs = await canonicalGet(
    `auction_listings_all?select=fee_schedule:raw_payload->fee_schedule`
    + `&event_id=eq.${ev.rows[0].id}&raw_payload->>fee_schedule=not.is.null&limit=1`
  );
  if (fs.ok && fs.rows.length) {
    try {
      feeSchedule = normalizeFeeSchedule(fs.rows[0].fee_schedule);
    } catch {
      feeSchedule = null;
    }
  }

  return NextResponse.json({ event: ev.rows[0], rows: res.rows, fee_schedule: feeSchedule });
}

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = body.mode === 'estimate' ? 'estimate' : 'result';

  // Fee schedule: an explicit tiered schedule wins; a bare buyer_premium_pct
  // still works and normalizes to a single flat tier.
  let feeSchedule;
  try {
    feeSchedule = normalizeFeeSchedule(
      body.fee_schedule != null && body.fee_schedule !== '' ? body.fee_schedule : body.buyer_premium_pct
    );
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  const lotCategory = normalizeCategory(body.lot_category);
  // A schedule that has no row for this lot's category (and no catch-all) would
  // silently save the lot without a premium — say so instead.
  if (feeSchedule && !tierSetForCategory(feeSchedule, lotCategory)) {
    return NextResponse.json(
      { error: `No buyer premium tier for lot category '${lotCategory}' in this fee schedule` },
      { status: 400 }
    );
  }

  if (!body.make || !body.model) {
    return NextResponse.json({ error: 'make and model are required' }, { status: 400 });
  }

  const eventSlug = slug(body.event_name) || 'live';
  const listingId = body.source_listing_id
    || (body.lot
      ? `${eventSlug}-lot-${slug(body.lot)}`
      : `${eventSlug}-${slug(`${body.year || ''} ${body.make} ${body.model}`)}-${Date.now().toString(36)}`);

  const rawTitle = body.raw_title
    || [body.year, body.make, body.model, body.trim].filter(Boolean).join(' ');

  const payload = {
    raw_title: rawTitle,
    year: body.year != null && body.year !== '' ? parseInt(body.year, 10) : undefined,
    make: body.make,
    model: body.model,
    trim: body.trim || undefined,
    vin: body.vin || undefined,
    mileage: body.mileage != null && body.mileage !== '' ? parseInt(String(body.mileage).replace(/[^\d]/g, ''), 10) : undefined,
    currency: (body.currency || 'USD').toUpperCase(),
    event_name: body.event_name || undefined,
    event_house: body.event_house || undefined,
    event_location: body.event_location || undefined,
  };

  if (mode === 'estimate') {
    payload.status = 'upcoming';
    if (body.estimate_low != null && body.estimate_low !== '') payload.estimate_low = Number(body.estimate_low);
    if (body.estimate_high != null && body.estimate_high !== '') payload.estimate_high = Number(body.estimate_high);
    if (body.ends_at || body.sale_date) payload.ends_at = body.ends_at || body.sale_date;
  } else {
    const outcome = body.outcome || 'sold';
    if (!['sold', 'reserve_not_met', 'withdrawn'].includes(outcome)) {
      return NextResponse.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 });
    }
    if (outcome === 'sold' && (body.price == null || Number(body.price) <= 0)) {
      return NextResponse.json({ error: 'sold lots need a price' }, { status: 400 });
    }
    payload.status = 'ended';
    payload.outcome = outcome;
    payload.ended_at = body.ended_at || body.sale_date || new Date().toISOString().slice(0, 10);
    if (outcome === 'sold') {
      payload.price = Number(body.price);
      const fee = computePremium(payload.price, feeSchedule, lotCategory);
      if (fee) {
        // buyer_premium_pct carries the blended rate this lot actually paid, so
        // a single number still describes the sale; the tiers that produced it
        // ride along for audit (and to reload the schedule in the UI).
        payload.buyer_premium_pct = fee.effective_pct;
        payload.price_all_in = fee.price_all_in;
        payload.fee_schedule = feeSchedule;
        payload.fee_applied = {
          category: fee.category,
          mode: fee.mode,
          premium: fee.premium,
          effective_pct: fee.effective_pct,
          breakdown: fee.breakdown,
        };
      }
      // An explicitly supplied all-in price still wins — an admin correcting
      // one odd lot (a house discount, a charity lot) shouldn't have to edit
      // the schedule. The rate then describes the override, not the tiers.
      if (body.price_all_in != null && body.price_all_in !== '') {
        payload.price_all_in = Number(body.price_all_in);
        payload.buyer_premium_pct =
          Math.round(((payload.price_all_in - payload.price) / payload.price) * 1e6) / 1e4;
        if (payload.fee_applied) payload.fee_applied.overridden = true;
      }
    } else if (body.price != null && body.price !== '') {
      payload.current_bid = Number(body.price); // RNM high bid, never a price
    }
    // Also carry estimates if supplied alongside a result (single-pass entry)
    if (body.estimate_low != null && body.estimate_low !== '') payload.estimate_low = Number(body.estimate_low);
    if (body.estimate_high != null && body.estimate_high !== '') payload.estimate_high = Number(body.estimate_high);
  }
  // FX policy: the store holds USD. Non-USD amounts are converted at the ECB
  // rate for the day of the auction (sale_date / ended_at; pre-auction
  // estimates use the latest rate until the results pass re-enters them).
  // The rate lands in fx_rate_usd and the original amounts survive under
  // original_* in raw_payload.
  if (payload.currency !== 'USD') {
    const fxDate = mode === 'result' ? payload.ended_at : (body.sale_date || payload.ends_at);
    let rate;
    try {
      rate = await getUsdRate(payload.currency, fxDate);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    payload.original_currency = payload.currency;
    for (const field of ['price', 'current_bid', 'estimate_low', 'estimate_high', 'price_all_in']) {
      if (payload[field] != null) {
        payload[`original_${field}`] = payload[field];
        payload[field] = Math.round(payload[field] * rate * 100) / 100;
      }
    }
    payload.currency = 'USD';
    payload.fx_rate_usd = rate;
  }

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const res = await canonicalRpc('auction_upsert_listing', {
    p_source_id: 'manual',
    p_source_listing_id: listingId,
    p_payload: payload,
    p_entered_by: 'manual',
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, id: res.data, source_listing_id: listingId, mode, payload });
}
