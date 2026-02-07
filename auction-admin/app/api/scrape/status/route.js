import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient } from '../lib';

/**
 * GET /api/scrape/status
 *
 * Returns an overview of manual auction data in the database.
 * Helps Claude Code understand what data exists and what gaps need filling.
 *
 * USAGE:
 *
 *   GET /api/scrape/status
 *   GET /api/scrape/status?league_id=<uuid>
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "counts": {
 *       "total_manual": 42,
 *       "active": 15,
 *       "needs_final_price": 8,
 *       "completed": 19
 *     },
 *     "needs_attention": [...],       // auctions missing key fields
 *     "needs_final_price": [...],     // ended auctions without final_price
 *     "active_auctions": [...],       // currently running auctions
 *     "leagues": [...]                // leagues using manual auctions
 *   }
 */
export async function GET(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('league_id');
    const now = Math.floor(Date.now() / 1000);

    // If league_id, scope to that league's auctions
    let auctionIdFilter = null;
    if (leagueId) {
      const { data } = await supabase
        .from('league_auctions')
        .select('auction_id')
        .eq('league_id', leagueId);
      auctionIdFilter = data?.map(la => la.auction_id) || [];
    }

    // Helper to build a scoped query
    const scopedQuery = (selectExpr, opts = {}) => {
      let q = supabase.from('auctions').select(selectExpr, opts);
      q = q.like('auction_id', 'manual_%'); // Only manual auctions
      if (auctionIdFilter) q = q.in('auction_id', auctionIdFilter);
      return q;
    };

    // Total manual auctions
    const { count: totalManual } = await scopedQuery('*', { count: 'exact', head: true });

    // Active (not ended, no final price)
    const { data: activeAuctions, count: activeCount } = await scopedQuery(
      'auction_id, title, url, current_bid, price_at_48h, timestamp_end, image_url, make, model, year',
      { count: 'exact' }
    ).gt('timestamp_end', now).is('final_price', null).order('timestamp_end', { ascending: true });

    // Ended, needs final price
    const { data: needsFinalPrice, count: needsFinalPriceCount } = await scopedQuery(
      'auction_id, title, url, current_bid, timestamp_end',
      { count: 'exact' }
    ).lt('timestamp_end', now).is('final_price', null).order('timestamp_end', { ascending: false }).limit(50);

    // Completed (have final price)
    const { count: completedCount } = await scopedQuery('*', { count: 'exact', head: true })
      .not('final_price', 'is', null);

    // Find auctions missing key data
    const needsAttention = [];
    if (activeAuctions) {
      for (const a of activeAuctions) {
        const issues = [];
        if (!a.image_url) issues.push('missing image_url');
        if (!a.price_at_48h) issues.push('missing price_at_48h');
        if (!a.current_bid) issues.push('missing current_bid');
        if (!a.url) issues.push('missing url');
        if (!a.make) issues.push('missing make');
        if (!a.model) issues.push('missing model');
        if (!a.year) issues.push('missing year');
        if (issues.length > 0) {
          needsAttention.push({
            auction_id: a.auction_id,
            title: a.title,
            issues,
          });
        }
      }
    }

    // Get manual-auction leagues for context
    const { data: manualLeagues } = await supabase
      .from('leagues')
      .select('id, name, status, draft_starts_at, draft_ends_at, use_manual_auctions')
      .eq('use_manual_auctions', true)
      .order('draft_starts_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      counts: {
        total_manual: totalManual || 0,
        active: activeCount || 0,
        needs_final_price: needsFinalPriceCount || 0,
        completed: completedCount || 0,
      },
      needs_attention: needsAttention.slice(0, 30),
      needs_final_price: (needsFinalPrice || []).slice(0, 30),
      active_auctions: (activeAuctions || []).slice(0, 30),
      leagues: manualLeagues || [],
    });

  } catch (error) {
    console.error('Status error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
