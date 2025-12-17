import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Helper to create supabase client with service role key
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// PATCH - Update auction final price
export async function PATCH(request) {
  const supabase = getSupabaseClient();
  try {
    const body = await request.json();
    const { auction_id, final_price } = body;

    if (!auction_id) {
      return NextResponse.json(
        { error: 'Missing required field: auction_id' },
        { status: 400 }
      );
    }

    if (final_price === undefined || final_price === null) {
      return NextResponse.json(
        { error: 'Missing required field: final_price' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('auctions')
      .update({ final_price: parseFloat(final_price) })
      .eq('auction_id', auction_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      auction: data,
      message: `Final price updated to $${parseFloat(final_price).toLocaleString()}`
    });

  } catch (error) {
    console.error('Error updating auction:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Bulk update final prices for multiple auctions
export async function POST(request) {
  const supabase = getSupabaseClient();
  try {
    const body = await request.json();
    const { auctions } = body;

    if (!auctions || !Array.isArray(auctions) || auctions.length === 0) {
      return NextResponse.json(
        { error: 'Missing required field: auctions (array of {auction_id, final_price})' },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    for (const auction of auctions) {
      if (!auction.auction_id || auction.final_price === undefined) {
        errors.push({ auction_id: auction.auction_id, error: 'Missing auction_id or final_price' });
        continue;
      }

      const { data, error } = await supabase
        .from('auctions')
        .update({ final_price: parseFloat(auction.final_price) })
        .eq('auction_id', auction.auction_id)
        .select()
        .single();

      if (error) {
        errors.push({ auction_id: auction.auction_id, error: error.message });
      } else {
        results.push(data);
      }
    }

    return NextResponse.json({
      success: true,
      updated: results.length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Error bulk updating auctions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET - Get ended auctions that need final prices
export async function GET(request) {
  const supabase = getSupabaseClient();
  try {
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');
    const now = Math.floor(Date.now() / 1000);

    let query = supabase
      .from('auctions')
      .select('*')
      .lt('timestamp_end', now)  // Auction has ended
      .is('final_price', null)   // No final price set yet
      .order('timestamp_end', { ascending: false });

    // If leagueId is provided, filter to league auctions
    if (leagueId) {
      const { data: leagueAuctions } = await supabase
        .from('league_auctions')
        .select('auction_id')
        .eq('league_id', leagueId);

      if (leagueAuctions && leagueAuctions.length > 0) {
        const auctionIds = leagueAuctions.map(la => la.auction_id);
        query = query.in('auction_id', auctionIds);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({
      auctions: data || [],
      count: data?.length || 0,
      message: `Found ${data?.length || 0} ended auctions without final prices`
    });

  } catch (error) {
    console.error('Error fetching auctions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
