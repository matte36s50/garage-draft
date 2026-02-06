import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient } from '../lib';

/**
 * GET /api/scrape/status
 *
 * Returns an overview of auction data in the database, including:
 *   - Total auctions
 *   - Active auctions (not yet ended)
 *   - Ended auctions awaiting final prices
 *   - Completed auctions (have final prices)
 *   - Auctions missing key data (no image, no price_at_48h, etc.)
 *
 * Optionally filter by league:
 *   GET /api/scrape/status?leagueId=<uuid>
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "counts": { "total": 150, "active": 30, "needsFinalPrice": 15, ... },
 *     "needsAttention": [ { auction_id, title, issue }, ... ],
 *     "recentlyEnded": [ ... ]
 *   }
 */
export async function GET(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');
    const now = Math.floor(Date.now() / 1000);

    // If leagueId, get the auction IDs for that league
    let leagueAuctionIds = null;
    if (leagueId) {
      const { data } = await supabase
        .from('league_auctions')
        .select('auction_id')
        .eq('league_id', leagueId);
      leagueAuctionIds = data?.map(la => la.auction_id) || [];
    }

    // Build base query
    let baseQuery = () => {
      let q = supabase.from('auctions').select('*', { count: 'exact', head: false });
      if (leagueAuctionIds) q = q.in('auction_id', leagueAuctionIds);
      return q;
    };

    // Total count
    const { count: total } = await (() => {
      let q = supabase.from('auctions').select('*', { count: 'exact', head: true });
      if (leagueAuctionIds) q = q.in('auction_id', leagueAuctionIds);
      return q;
    })();

    // Active (not yet ended)
    const { data: activeAuctions, count: activeCount } = await (() => {
      let q = supabase.from('auctions')
        .select('auction_id, title, url, current_bid, timestamp_end, image_url, price_at_48h', { count: 'exact' })
        .gt('timestamp_end', now)
        .is('final_price', null)
        .order('timestamp_end', { ascending: true });
      if (leagueAuctionIds) q = q.in('auction_id', leagueAuctionIds);
      return q;
    })();

    // Ended, needs final price
    const { data: needsFinalPrice, count: needsFinalPriceCount } = await (() => {
      let q = supabase.from('auctions')
        .select('auction_id, title, url, current_bid, timestamp_end', { count: 'exact' })
        .lt('timestamp_end', now)
        .is('final_price', null)
        .order('timestamp_end', { ascending: false })
        .limit(50);
      if (leagueAuctionIds) q = q.in('auction_id', leagueAuctionIds);
      return q;
    })();

    // Completed (have final price)
    const { count: completedCount } = await (() => {
      let q = supabase.from('auctions')
        .select('*', { count: 'exact', head: true })
        .not('final_price', 'is', null);
      if (leagueAuctionIds) q = q.in('auction_id', leagueAuctionIds);
      return q;
    })();

    // Find auctions needing attention (missing key data)
    const needsAttention = [];

    if (activeAuctions) {
      for (const a of activeAuctions) {
        const issues = [];
        if (!a.image_url) issues.push('missing image');
        if (!a.price_at_48h) issues.push('missing price_at_48h');
        if (!a.current_bid) issues.push('missing current_bid');
        if (!a.url) issues.push('missing url');
        if (issues.length > 0) {
          needsAttention.push({
            auction_id: a.auction_id,
            title: a.title,
            issues,
          });
        }
      }
    }

    // Recently ended (last 24h) without final price
    const oneDayAgo = now - 86400;
    const recentlyEnded = (needsFinalPrice || []).filter(a =>
      a.timestamp_end > oneDayAgo
    );

    return NextResponse.json({
      success: true,
      counts: {
        total: total || 0,
        active: activeCount || 0,
        needsFinalPrice: needsFinalPriceCount || 0,
        completed: completedCount || 0,
      },
      needsAttention: needsAttention.slice(0, 30),
      needsFinalPrice: (needsFinalPrice || []).slice(0, 30),
      recentlyEnded: recentlyEnded.slice(0, 20),
      activeAuctions: (activeAuctions || []).slice(0, 30),
    });

  } catch (error) {
    console.error('Status error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
