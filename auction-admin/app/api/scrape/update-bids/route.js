import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient, parseAuctionHtml, USER_AGENTS } from '../lib';

/**
 * POST /api/scrape/update-bids
 *
 * Updates current bids for active auctions. Two modes:
 *
 *   1) Provide pre-scraped bid data directly:
 *      POST /api/scrape/update-bids
 *      {
 *        "bids": [
 *          { "auction_id": "bat-1985-porsche-911", "current_bid": 45000 },
 *          { "auction_id": "bat-2015-bmw-m3", "current_bid": 32000, "price_at_48h": 28000 }
 *        ]
 *      }
 *
 *   2) Server-side scrape — provide auction URLs to scrape:
 *      POST /api/scrape/update-bids
 *      { "scrape": true, "limit": 20 }
 *
 *      This fetches active auctions from the DB, scrapes their BaT pages,
 *      and updates current_bid values.
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "updated": 15,
 *     "failed": 2,
 *     "results": [...]
 *   }
 */
export async function POST(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const body = await request.json();

    // Mode 1: Direct bid updates
    if (body.bids && Array.isArray(body.bids)) {
      return await handleDirectBidUpdates(supabase, body.bids);
    }

    // Mode 2: Server-side scrape
    if (body.scrape) {
      return await handleServerScrape(supabase, body.limit || 20);
    }

    return NextResponse.json(
      { error: 'Provide either "bids" array or "scrape": true' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Update-bids error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleDirectBidUpdates(supabase, bids) {
  const results = { updated: [], failed: [] };

  for (const bid of bids) {
    if (!bid.auction_id) {
      results.failed.push({ ...bid, error: 'Missing auction_id' });
      continue;
    }

    const updateData = {};
    if (bid.current_bid !== undefined) updateData.current_bid = bid.current_bid;
    if (bid.price_at_48h !== undefined) updateData.price_at_48h = bid.price_at_48h;
    if (bid.final_price !== undefined) updateData.final_price = bid.final_price;
    if (bid.image_url) updateData.image_url = bid.image_url;
    if (bid.title) updateData.title = bid.title;

    if (Object.keys(updateData).length === 0) {
      results.failed.push({ auction_id: bid.auction_id, error: 'No fields to update' });
      continue;
    }

    const { data, error } = await supabase
      .from('auctions')
      .update(updateData)
      .eq('auction_id', bid.auction_id)
      .select()
      .single();

    if (error) {
      results.failed.push({ auction_id: bid.auction_id, error: error.message });
    } else {
      results.updated.push(data);
    }
  }

  return NextResponse.json({
    success: true,
    updated: results.updated.length,
    failed: results.failed.length,
    results: {
      updated: results.updated.slice(0, 50),
      failed: results.failed.slice(0, 50),
    },
  });
}

async function handleServerScrape(supabase, limit) {
  const now = Math.floor(Date.now() / 1000);

  // Get active auctions (not ended, have a BaT URL, no final price)
  const { data: auctions, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, url, current_bid, timestamp_end')
    .gt('timestamp_end', now) // Not yet ended
    .is('final_price', null)  // Not finalized
    .not('url', 'is', null)   // Has a URL
    .order('timestamp_end', { ascending: true }) // Ending soonest first
    .limit(Math.min(limit, 50));

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!auctions || auctions.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No active auctions to update',
      updated: 0,
      failed: 0,
    });
  }

  const batAuctions = auctions.filter(a =>
    a.url?.includes('bringatrailer.com') &&
    !a.auction_id?.startsWith('manual_')
  );

  const results = { updated: [], failed: [] };

  for (const auction of batAuctions) {
    try {
      // Small delay between requests
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

      const resp = await fetch(auction.url, {
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        results.failed.push({ auction_id: auction.auction_id, error: `HTTP ${resp.status}` });
        continue;
      }

      const html = await resp.text();
      const parsed = parseAuctionHtml(html, auction.url);

      const updateData = {};
      if (parsed.currentBid && parsed.currentBid !== auction.current_bid) {
        updateData.current_bid = parsed.currentBid;
      }
      if (parsed.imageUrl) updateData.image_url = parsed.imageUrl;

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('auctions')
          .update(updateData)
          .eq('auction_id', auction.auction_id);

        if (updateError) {
          results.failed.push({ auction_id: auction.auction_id, error: updateError.message });
        } else {
          results.updated.push({
            auction_id: auction.auction_id,
            title: auction.title,
            previousBid: auction.current_bid,
            newBid: parsed.currentBid,
          });
        }
      }
    } catch (err) {
      results.failed.push({ auction_id: auction.auction_id, error: err.message?.slice(0, 100) });
    }
  }

  return NextResponse.json({
    success: true,
    updated: results.updated.length,
    failed: results.failed.length,
    results: {
      updated: results.updated.slice(0, 50),
      failed: results.failed.slice(0, 50),
    },
  });
}
