import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * RECLASSIFY WRONGLY-WITHDRAWN AUCTION
 *
 * The python lambda used to over-aggressively mark auctions as withdrawn
 * (final_price=0). This endpoint flips one such row back to reserve_not_met:
 *   final_price=null, reserve_not_met=true
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

  const { error: updateErr } = await supabase
    .from('auctions')
    .update({ final_price: null, reserve_not_met: true })
    .eq('auction_id', auctionId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true, auction_id: auctionId });
}
