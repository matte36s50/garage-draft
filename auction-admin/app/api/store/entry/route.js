import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../lib/canonicalStore';

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
  return NextResponse.json({ event: ev.rows[0], rows: res.rows });
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
    if (body.ends_at) payload.ends_at = body.ends_at;
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
    payload.ended_at = body.ended_at || new Date().toISOString().slice(0, 10);
    if (outcome === 'sold') {
      payload.price = Number(body.price);
      if (body.buyer_premium_pct != null && body.buyer_premium_pct !== '') {
        payload.buyer_premium_pct = Number(body.buyer_premium_pct);
      }
      if (body.price_all_in != null && body.price_all_in !== '') {
        payload.price_all_in = Number(body.price_all_in);
      }
    } else if (body.price != null && body.price !== '') {
      payload.current_bid = Number(body.price); // RNM high bid, never a price
    }
    // Also carry estimates if supplied alongside a result (single-pass entry)
    if (body.estimate_low != null && body.estimate_low !== '') payload.estimate_low = Number(body.estimate_low);
    if (body.estimate_high != null && body.estimate_high !== '') payload.estimate_high = Number(body.estimate_high);
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
