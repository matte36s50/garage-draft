import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient, generateManualAuctionId } from '../lib';

/**
 * POST /api/scrape/ingest
 *
 * Create or update manual auctions from data scraped from ANY auction site.
 * Claude Code fetches pages, extracts data, then sends structured results here.
 *
 * USAGE:
 *
 *   POST /api/scrape/import
 *   {
 *     "auctions": [
 *       {
 *         "title": "1985 Porsche 911 Carrera",
 *         "make": "Porsche",
 *         "model": "911 Carrera",
 *         "year": 1985,
 *         "url": "https://mecum.com/lots/FL0124-410826/",
 *         "image_url": "https://...",
 *         "current_bid": 45000,
 *         "price_at_48h": 38000,
 *         "timestamp_end": 1700000000,
 *         "final_price": null
 *       }
 *     ],
 *     "league_id": "optional-league-uuid-to-link-auctions"
 *   }
 *
 * FIELD REFERENCE:
 *   - title (string, required): Full auction title e.g. "1985 Porsche 911 Carrera"
 *   - make (string): Manufacturer e.g. "Porsche"
 *   - model (string): Model name e.g. "911 Carrera"
 *   - year (number): Model year e.g. 1985
 *   - url (string): Source URL on the auction site
 *   - image_url (string): Main photo URL
 *   - current_bid (number): Current/latest bid amount in dollars
 *   - price_at_48h (number): Locked draft price (price when drafted by players)
 *   - timestamp_end (number): Unix timestamp (seconds) when auction ends
 *   - final_price (number): Final sale price (null if still active)
 *   - auction_id (string): Optional custom ID; auto-generated as manual_<slug> if omitted
 *
 * NOTES:
 *   - IDs are auto-prefixed with "manual_" if not already
 *   - Existing auctions (same auction_id) are updated without overwriting non-null fields with null
 *   - If league_id is provided, auctions are also linked to that league via league_auctions
 *   - Maximum 200 auctions per request
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "imported": 5,
 *     "updated": 2,
 *     "failed": 0,
 *     "results": { "imported": [...], "updated": [...], "failed": [...] }
 *   }
 */
export async function POST(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const body = await request.json();
    const { auctions, league_id } = body;

    if (!auctions || !Array.isArray(auctions) || auctions.length === 0) {
      return NextResponse.json(
        { error: 'Missing required field: auctions (array of auction objects with at least a title)' },
        { status: 400 }
      );
    }

    if (auctions.length > 200) {
      return NextResponse.json(
        { error: 'Too many auctions. Maximum 200 per request.' },
        { status: 400 }
      );
    }

    const results = { imported: [], updated: [], failed: [] };

    for (const auction of auctions) {
      try {
        if (!auction.title && !auction.url) {
          results.failed.push({ auction, error: 'Each auction needs at least a title or url' });
          continue;
        }

        // Generate or normalize the auction_id with manual_ prefix
        let auctionId = auction.auction_id;
        if (auctionId && !auctionId.startsWith('manual_')) {
          auctionId = `manual_${auctionId}`;
        }
        if (!auctionId) {
          auctionId = generateManualAuctionId(auction.url, auction.title);
        }

        // Check if this auction already exists
        const { data: existing } = await supabase
          .from('auctions')
          .select('auction_id')
          .eq('auction_id', auctionId)
          .single();

        const record = {
          auction_id: auctionId,
          title: auction.title || null,
          make: auction.make || null,
          model: auction.model || null,
          year: auction.year ? parseInt(auction.year, 10) : null,
          url: auction.url || null,
          image_url: auction.image_url || auction.imageUrl || null,
          current_bid: auction.current_bid != null ? parseFloat(auction.current_bid) : null,
          timestamp_end: auction.timestamp_end != null ? parseInt(auction.timestamp_end, 10) : null,
        };

        // Only set price_at_48h if provided
        if (auction.price_at_48h != null) {
          record.price_at_48h = parseFloat(auction.price_at_48h);
        }

        // Only set final_price if explicitly provided
        if (auction.final_price !== undefined) {
          record.final_price = auction.final_price != null ? parseFloat(auction.final_price) : null;
        }

        if (existing) {
          // Update existing — skip null values so we don't overwrite good data
          const updateData = {};
          for (const [key, value] of Object.entries(record)) {
            if (key === 'auction_id') continue;
            if (value !== null && value !== undefined) {
              updateData[key] = value;
            }
          }

          const { data, error } = await supabase
            .from('auctions')
            .update(updateData)
            .eq('auction_id', auctionId)
            .select()
            .single();

          if (error) throw error;
          results.updated.push(data);
        } else {
          // Insert new
          const { data, error } = await supabase
            .from('auctions')
            .insert(record)
            .select()
            .single();

          if (error) throw error;
          results.imported.push(data);
        }

        // Link to league if league_id is provided
        if (league_id) {
          await supabase
            .from('league_auctions')
            .upsert(
              { league_id, auction_id: auctionId },
              { onConflict: 'league_id,auction_id' }
            );
        }

      } catch (err) {
        results.failed.push({
          title: auction.title || auction.url || 'unknown',
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      imported: results.imported.length,
      updated: results.updated.length,
      failed: results.failed.length,
      results: {
        imported: results.imported.slice(0, 50),
        updated: results.updated.slice(0, 50),
        failed: results.failed.slice(0, 50),
      },
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
