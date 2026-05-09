import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * RECLASSIFY WRONGLY-WITHDRAWN AUCTION
 *
 * The python lambda used to over-aggressively mark auctions as withdrawn
 * (final_price=0). This endpoint flips one such row to either:
 *   - reserve_not_met (default): final_price=null, reserve_not_met=true
 *   - sold: final_price=<provided>, reserve_not_met=false
 *
 * Pass `final_price` in the body to mark as sold; omit it to mark RNM.
 *
 * The notify_auction_ended SQL trigger fires only on NULL → non-NULL
 * transitions of final_price. Since these rows currently have final_price=0
 * (not NULL), we clear to NULL first, then write the sold price, so the
 * trigger fires and the league chat message gets posted.
 *
 * No auth: only reachable through the gated admin UI.
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const auctionId = body?.auction_id;
  if (!auctionId || typeof auctionId !== 'string') {
    return NextResponse.json({ error: 'auction_id required' }, { status: 400 });
  }

  let soldPrice = null;
  if (body?.final_price !== undefined && body?.final_price !== null && body?.final_price !== '') {
    const parsed = Number(body.final_price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'final_price must be a positive number' }, { status: 400 });
    }
    soldPrice = parsed;
  }

  const supabase = getSupabaseClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('auctions')
    .select('auction_id, final_price, current_bid')
    .eq('auction_id', auctionId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
  if (Number(existing.final_price) !== 0) {
    return NextResponse.json(
      { error: 'Only auctions with final_price=0 can be reclassified here' },
      { status: 400 }
    );
  }

  if (soldPrice !== null) {
    // Two-step: clear to NULL, then write sold price, so the SQL trigger fires.
    const { error: clearErr } = await supabase
      .from('auctions')
      .update({ final_price: null, reserve_not_met: false })
      .eq('auction_id', auctionId);
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });

    const { error: setErr } = await supabase
      .from('auctions')
      .update({ final_price: soldPrice, reserve_not_met: false })
      .eq('auction_id', auctionId);
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

    return NextResponse.json({ success: true, auction_id: auctionId, final_price: soldPrice });
  }

  const { error: updateErr } = await supabase
    .from('auctions')
    .update({ final_price: null, reserve_not_met: true })
    .eq('auction_id', auctionId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true, auction_id: auctionId, reserve_not_met: true });
}
