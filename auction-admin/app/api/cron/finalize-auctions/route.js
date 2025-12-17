import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * AUCTION FINALIZER CRON JOB
 *
 * Scrapes BringATrailer pages to get final sale prices for ended auctions.
 *
 * HOW TO USE:
 * - Manual: GET /api/cron/finalize-auctions?secret=YOUR_CRON_SECRET
 * - Scheduled: Set up Vercel Cron or external service (cron-job.org, etc.)
 * - Recommended schedule: Every 30 minutes or hourly
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// User agents to rotate through
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
];

/**
 * Extract final price from BaT HTML
 */
function extractPriceFromHtml(html) {
  // Pattern 1: "Sold for USD $XX,XXX" or "Sold for $XX,XXX"
  let match = html.match(/Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i);
  if (match) {
    return { price: parseInt(match[1].replace(/,/g, ''), 10), status: 'sold' };
  }

  // Pattern 2: "High Bid $XX,XXX" (reserve not met)
  match = html.match(/High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)/i);
  if (match) {
    return { price: parseInt(match[1].replace(/,/g, ''), 10), status: 'no_sale' };
  }

  // Pattern 3: Strong USD element
  match = html.match(/<strong>USD\s+\$\s*([\d,]+)<\/strong>/i);
  if (match) {
    const price = parseInt(match[1].replace(/,/g, ''), 10);
    const status = /Sold\s+for/i.test(html) ? 'sold' : 'no_sale';
    return { price, status };
  }

  // Pattern 4: Look for "final-bid-info" or similar class with price
  match = html.match(/class="[^"]*(?:final|sold|winning)[^"]*"[^>]*>.*?\$\s*([\d,]+)/i);
  if (match) {
    return { price: parseInt(match[1].replace(/,/g, ''), 10), status: 'sold' };
  }

  return { price: null, status: null };
}

/**
 * Scrape a single BaT auction page
 */
async function scrapeAuctionPrice(url) {
  try {
    // Add small delay to be polite
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

    const headers = {
      'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };

    console.log(`   🌐 Fetching: ${url}`);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (response.status === 403) {
      return { price: null, status: null, error: '403 Forbidden - might be blocked' };
    }

    if (!response.ok) {
      return { price: null, status: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const { price, status } = extractPriceFromHtml(html);

    if (price) {
      console.log(`   💰 Found price: $${price.toLocaleString()} (${status})`);
      return { price, status, error: null };
    }

    // Debug: log any dollar amounts found
    const dollarMatches = html.match(/\$[\d,]+/g)?.slice(0, 5);
    console.log(`   ⚠️ No price pattern matched. Sample amounts found: ${dollarMatches?.join(', ') || 'none'}`);

    return { price: null, status: null, error: 'No price pattern matched' };

  } catch (error) {
    if (error.name === 'TimeoutError') {
      return { price: null, status: null, error: 'Timeout' };
    }
    return { price: null, status: null, error: error.message?.slice(0, 100) };
  }
}

export async function GET(request) {
  const supabase = getSupabaseClient();

  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const secretParam = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const isValidHeader = authHeader === `Bearer ${cronSecret}`;
    const isValidParam = secretParam === cronSecret;

    if (!isValidHeader && !isValidParam) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('=' .repeat(50));
  console.log('🚀 Auction Finalizer - Starting');
  console.log(`🕐 Time: ${new Date().toISOString()}`);
  console.log('=' .repeat(50));

  try {
    // Get auctions that ended more than 2 hours ago but have no final_price
    const now = Math.floor(Date.now() / 1000);
    const twoHoursAgo = now - (2 * 60 * 60);

    const { data: auctions, error: fetchError } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end')
      .lt('timestamp_end', twoHoursAgo)  // Ended more than 2 hours ago
      .is('final_price', null)           // No final price yet
      .not('url', 'is', null)            // Has a URL to scrape
      .order('timestamp_end', { ascending: false })
      .limit(50);  // Process in batches

    if (fetchError) {
      console.error('Error fetching auctions:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!auctions || auctions.length === 0) {
      console.log('📭 No auctions need finalization');
      return NextResponse.json({
        success: true,
        message: 'No auctions to finalize',
        processed: 0
      });
    }

    console.log(`📋 Found ${auctions.length} auctions to process`);

    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    for (let i = 0; i < auctions.length; i++) {
      const auction = auctions[i];
      console.log(`\n[${i + 1}/${auctions.length}] Processing: ${auction.title?.slice(0, 60)}`);
      console.log(`   ID: ${auction.auction_id}`);

      if (!auction.url) {
        console.log('   ⏭️ Skipped: No URL');
        results.skipped.push({ id: auction.auction_id, reason: 'No URL' });
        continue;
      }

      const { price, status, error } = await scrapeAuctionPrice(auction.url);

      if (price && price > 0) {
        // Only update if it was a successful sale
        if (status === 'sold') {
          const { error: updateError } = await supabase
            .from('auctions')
            .update({ final_price: price })
            .eq('auction_id', auction.auction_id);

          if (updateError) {
            console.log(`   ❌ DB Update failed: ${updateError.message}`);
            results.failed.push({
              id: auction.auction_id,
              title: auction.title,
              error: `DB update failed: ${updateError.message}`
            });
          } else {
            console.log(`   ✅ Updated with final price: $${price.toLocaleString()}`);
            results.successful.push({
              id: auction.auction_id,
              title: auction.title,
              finalPrice: price
            });
          }
        } else {
          // Reserve not met - we could optionally mark these differently
          console.log(`   ⚠️ Reserve not met (high bid: $${price.toLocaleString()})`);
          results.skipped.push({
            id: auction.auction_id,
            title: auction.title,
            reason: `Reserve not met (high bid: $${price.toLocaleString()})`
          });
        }
      } else {
        console.log(`   ❌ Failed: ${error}`);
        results.failed.push({
          id: auction.auction_id,
          title: auction.title,
          error: error
        });
      }
    }

    // Summary
    const successCount = results.successful.length;
    const failCount = results.failed.length;
    const skipCount = results.skipped.length;
    const total = successCount + failCount + skipCount;
    const successRate = total > 0 ? Math.round(successCount / total * 100) : 0;

    console.log('\n' + '=' .repeat(50));
    console.log('📊 SUMMARY');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⏭️ Skipped: ${skipCount}`);
    console.log(`   📈 Success rate: ${successRate}%`);
    console.log('=' .repeat(50));

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processed: total,
      successful: successCount,
      failed: failCount,
      skipped: skipCount,
      successRate,
      results: {
        successful: results.successful.slice(0, 10),
        failed: results.failed.slice(0, 10),
        skipped: results.skipped.slice(0, 10)
      }
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Support POST for manual triggers
export async function POST(request) {
  return GET(request);
}
