import { NextResponse } from 'next/server';
import { verifyAuth, parseAuctionHtml, parseListingsHtml } from '../lib';

/**
 * POST /api/scrape/parse
 *
 * Accepts raw HTML from a BaT page and returns structured auction data.
 * This endpoint does NOT touch the database — it only parses.
 *
 * USAGE (from Claude Code or any HTTP client):
 *
 *   1) Parse a single auction page:
 *      POST /api/scrape/parse
 *      { "html": "<html>...</html>", "url": "https://bringatrailer.com/listing/...", "mode": "auction" }
 *
 *   2) Parse a listings/search page to discover auctions:
 *      POST /api/scrape/parse
 *      { "html": "<html>...</html>", "mode": "listings" }
 *
 * RESPONSE (auction mode):
 *   {
 *     "success": true,
 *     "auction": { title, make, model, year, currentBid, imageUrl, timestampEnd, ... }
 *   }
 *
 * RESPONSE (listings mode):
 *   {
 *     "success": true,
 *     "auctions": [{ url, title, imageUrl, currentBid, noReserve }, ...]
 *   }
 */
export async function POST(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { html, url, mode = 'auction' } = body;

    if (!html) {
      return NextResponse.json(
        { error: 'Missing required field: html (raw HTML content from a BaT page)' },
        { status: 400 }
      );
    }

    if (mode === 'listings') {
      const auctions = parseListingsHtml(html);
      return NextResponse.json({
        success: true,
        count: auctions.length,
        auctions,
      });
    }

    // Default: parse a single auction page
    const auction = parseAuctionHtml(html, url || '');
    return NextResponse.json({
      success: true,
      auction,
    });

  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
