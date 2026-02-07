import { NextResponse } from 'next/server';
import { verifyAuth, getSupabaseClient } from '../lib';

/**
 * POST /api/scrape/update-bids
 *
 * Batch-update fields on existing manual auctions.
 * Claude Code re-scrapes auction pages and sends updated data here.
 *
 * USAGE:
 *
 *   POST /api/scrape/update-bids
 *   {
 *     "updates": [
 *       {
 *         "auction_id": "manual_mecum-lots-FL0124-410826",
 *         "current_bid": 52000,
 *         "final_price": 58500
 *       },
 *       {
 *         "auction_id": "manual_1985-porsche-911-carrera",
 *         "current_bid": 47000,
 *         "image_url": "https://..."
 *       }
 *     ]
 *   }
 *
 * UPDATABLE FIELDS:
 *   - current_bid (number): Latest bid amount
 *   - price_at_48h (number): Locked draft price
 *   - final_price (number): Final sale price (set when auction ends)
 *   - image_url (string): Main photo URL
 *   - title (string): Updated title
 *   - timestamp_end (number): Updated end time
 *   - url (string): Updated source URL
 *
 * RESPONSE:
 *   {
 *     "success": true,
 *     "updated": 8,
 *     "failed": 1,
 *     "results": { "updated": [...], "failed": [...] }
 *   }
 */
export async function POST(request) {
  const authError = verifyAuth(request);
  if (authError) return authError;

  const supabase = getSupabaseClient();

  try {
    const body = await request.json();
    const { updates } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: 'Missing required field: updates (array of { auction_id, ...fields })' },
        { status: 400 }
      );
    }

    if (updates.length > 200) {
      return NextResponse.json(
        { error: 'Too many updates. Maximum 200 per request.' },
        { status: 400 }
      );
    }

    const ALLOWED_FIELDS = [
      'current_bid', 'price_at_48h', 'final_price',
      'image_url', 'title', 'timestamp_end', 'url',
      'make', 'model', 'year',
    ];

    const results = { updated: [], failed: [] };

    for (const update of updates) {
      if (!update.auction_id) {
        results.failed.push({ ...update, error: 'Missing auction_id' });
        continue;
      }

      // Build update object from allowed fields only
      const updateData = {};
      for (const field of ALLOWED_FIELDS) {
        if (update[field] !== undefined) {
          updateData[field] = update[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        results.failed.push({ auction_id: update.auction_id, error: 'No updatable fields provided' });
        continue;
      }

      const { data, error } = await supabase
        .from('auctions')
        .update(updateData)
        .eq('auction_id', update.auction_id)
        .select()
        .single();

      if (error) {
        results.failed.push({ auction_id: update.auction_id, error: error.message });
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

  } catch (error) {
    console.error('Update-bids error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
