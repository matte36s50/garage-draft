import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../lib/canonicalStore';

/**
 * POST /api/store/entry — manual live-auction lot entry (unified panel).
 *
 * Body:
 *   {
 *     event_name, event_house, event_location,   // event get-or-create
 *     lot,                                       // lot number (stable id part)
 *     year, make, model, trim, vin, mileage,
 *     raw_title,                                 // optional; composed if absent
 *     outcome: 'sold' | 'reserve_not_met' | 'withdrawn',
 *     price,                                     // hammer (sold) / high bid (RNM)
 *     buyer_premium_pct,                         // optional; all-in computed
 *     price_all_in,                              // optional; wins over computed
 *     currency,                                  // default USD
 *     ended_at                                   // default today
 *   }
 *
 * Writes through the same door as every scraper:
 *   auction_upsert_listing(source 'manual', entered_by 'manual')
 */
export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const outcome = body.outcome || 'sold';
  if (!['sold', 'reserve_not_met', 'withdrawn'].includes(outcome)) {
    return NextResponse.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 });
  }
  if (!body.make || !body.model) {
    return NextResponse.json({ error: 'make and model are required' }, { status: 400 });
  }
  if (outcome === 'sold' && (body.price == null || Number(body.price) <= 0)) {
    return NextResponse.json({ error: 'sold lots need a price' }, { status: 400 });
  }

  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const eventSlug = slug(body.event_name) || 'live';
  const listingId = body.lot
    ? `${eventSlug}-lot-${slug(body.lot)}`
    : `${eventSlug}-${slug(`${body.year || ''} ${body.make} ${body.model}`)}-${Date.now().toString(36)}`;

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
    status: 'ended',
    outcome,
    currency: (body.currency || 'USD').toUpperCase(),
    ended_at: body.ended_at || new Date().toISOString().slice(0, 10),
    event_name: body.event_name || undefined,
    event_house: body.event_house || undefined,
    event_location: body.event_location || undefined,
  };
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
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const res = await canonicalRpc('auction_upsert_listing', {
    p_source_id: 'manual',
    p_source_listing_id: listingId,
    p_payload: payload,
    p_entered_by: 'manual',
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, id: res.data, source_listing_id: listingId, payload });
}
