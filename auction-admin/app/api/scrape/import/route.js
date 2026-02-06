import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient } from '../lib';

/**
 * POST /api/scrape/import
 *
 * Import one or more auctions into Supabase.
 * Accepts pre-parsed auction data (from /api/scrape/parse) and upserts into the auctions table.
 *
 * USAGE:
 *
 *   POST /api/scrape/import
 *   {
 *     "auctions": [
 *       {
 *         "url": "https://bringatrailer.com/listing/1985-porsche-911-carrera/",
 *         "title": "1985 Porsche 911 Carrera",
 *         "make": "Porsche",
 *         "model": "911 Carrera",
 *         "year": 1985,
 *         "imageUrl": "https://...",
 *         "currentBid": 45000,
 *         "timestampEnd": 1700000000,
 *         "noReserve": true
 *       }
 *     ],
 *     "leagueId": "optional-league-uuid-to-link-auctions"
 *   }
 *
 * Each auction gets an auto-generated auction_id derived from its URL slug.
 * Existing auctions (by auction_id) are updated; new ones are inserted.
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "imported": 5,
 *     "updated": 2,
 *     "failed": 0,
 *     "results": [...],
 *     "errors": [...]
 *   }
 */
export async function POST(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const body = await request.json();
    const { auctions, leagueId } = body;

    if (!auctions || !Array.isArray(auctions) || auctions.length === 0) {
      return NextResponse.json(
        { error: 'Missing required field: auctions (array of auction objects)' },
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
        if (!auction.url && !auction.auction_id) {
          results.failed.push({ auction, error: 'Missing url or auction_id' });
          continue;
        }

        const auctionId = auction.auction_id || deriveAuctionId(auction.url);
        if (!auctionId) {
          results.failed.push({ title: auction.title, error: 'Could not derive auction_id from URL' });
          continue;
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
          year: auction.year || null,
          url: auction.url || null,
          image_url: auction.imageUrl || auction.image_url || null,
          current_bid: auction.currentBid || auction.current_bid || null,
          timestamp_end: auction.timestampEnd || auction.timestamp_end || null,
        };

        // Only set price_at_48h if provided (don't overwrite existing)
        if (auction.priceAt48h || auction.price_at_48h) {
          record.price_at_48h = auction.priceAt48h || auction.price_at_48h;
        }

        // Only set final_price if explicitly provided
        if (auction.finalPrice !== undefined || auction.final_price !== undefined) {
          record.final_price = auction.finalPrice ?? auction.final_price;
        }

        let result;
        if (existing) {
          // Update existing — don't overwrite fields with null
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

        // Link to league if leagueId is provided
        if (leagueId) {
          await supabase
            .from('league_auctions')
            .upsert(
              { league_id: leagueId, auction_id: auctionId },
              { onConflict: 'league_id,auction_id' }
            );
        }

      } catch (err) {
        results.failed.push({
          title: auction.title || auction.url,
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

/**
 * Derive a stable auction_id from a BaT URL.
 * e.g. "https://bringatrailer.com/listing/1985-porsche-911-carrera-42/" → "bat-1985-porsche-911-carrera-42"
 */
function deriveAuctionId(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/\/$/, '');
    const slug = path.split('/').pop();
    if (slug) return `bat-${slug}`;
  } catch {
    // Try simple regex for malformed URLs
    const m = url.match(/listing\/([^/?]+)/);
    if (m) return `bat-${m[1]}`;
  }

  return null;
}
