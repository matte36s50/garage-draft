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
 * Supports multiple currencies: USD, EUR, GBP, CAD, AUD, CHF
 */
function extractPriceFromHtml(html) {
  // Check for withdrawn/cancelled listings first
  const withdrawnPatterns = [
    /listing\s+(?:has\s+been\s+)?(?:withdrawn|cancelled|removed)/i,
    /auction\s+(?:has\s+been\s+)?(?:withdrawn|cancelled|ended\s+early)/i,
    /this\s+listing\s+is\s+no\s+longer\s+available/i,
  ];

  for (const pattern of withdrawnPatterns) {
    if (pattern.test(html)) {
      return { price: null, status: 'withdrawn', currency: null };
    }
  }

  // Currency patterns - supports USD, EUR, GBP, CAD, AUD, CHF
  const salePatterns = [
    // USD patterns
    { pattern: /Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },

    // EUR patterns
    { pattern: /Sold\s+for\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },

    // GBP patterns
    { pattern: /Sold\s+for\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },

    // CAD patterns
    { pattern: /Sold\s+for\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Bid\s+to\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },

    // AUD patterns
    { pattern: /Sold\s+for\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Bid\s+to\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },

    // CHF patterns (Swiss use ' as thousands separator)
    { pattern: /Sold\s+for\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Bid\s+to\s+CHF\s*([\d,']+)/i, currency: 'CHF' },

    // Generic symbol patterns (fallback)
    { pattern: /Sold\s+for\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+£\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+£\s*([\d,]+)/i, currency: 'GBP' },

    // Strong tag patterns
    { pattern: /<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*<\/strong>/i, currency: 'USD' },
    { pattern: /<strong>\s*EUR\s*€?\s*([\d,\.]+)\s*<\/strong>/i, currency: 'EUR' },
  ];

  for (const { pattern, currency } of salePatterns) {
    const match = html.match(pattern);
    if (match) {
      let priceStr = match[1];

      // Handle different number formats
      if (currency === 'EUR' && priceStr.includes('.') && priceStr.includes(',')) {
        // European format: 120.000,00 -> 120000
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      } else if (currency === 'CHF') {
        // Swiss format: 120'000 -> 120000
        priceStr = priceStr.replace(/'/g, '');
      }

      // Remove commas and get integer part
      priceStr = priceStr.replace(/,/g, '');
      if (priceStr.includes('.')) {
        priceStr = priceStr.split('.')[0];
      }

      const price = parseInt(priceStr, 10);
      if (price > 0) {
        console.log(`   💰 Found: ${currency} ${price.toLocaleString()} (sold)`);
        return { price, status: 'sold', currency };
      }
    }
  }

  // Check for "High Bid" (reserve not met)
  const highBidPatterns = [
    { pattern: /High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /High\s+Bid\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Reserve\s+Not\s+Met.*?\$\s*([\d,]+)/i, currency: 'USD' },
  ];

  for (const { pattern, currency } of highBidPatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''), 10);
      console.log(`   ⚠️ Found: ${currency} ${price.toLocaleString()} (reserve not met)`);
      return { price, status: 'no_sale', currency };
    }
  }

  return { price: null, status: null, currency: null };
}

/**
 * Scrape a single BaT auction page
 */
async function scrapeAuctionPrice(url) {
  try {
    // Reduced delay - still polite but faster
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

    const headers = {
      'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,de;q=0.8,fr;q=0.7',
    };

    console.log(`   🌐 Fetching: ${url}`);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (response.status === 403) {
      return { price: null, status: null, currency: null, error: '403 Forbidden - might be blocked' };
    }

    if (response.status === 404) {
      return { price: null, status: 'withdrawn', currency: null, error: null };
    }

    if (!response.ok) {
      return { price: null, status: null, currency: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const { price, status, currency } = extractPriceFromHtml(html);

    if (status === 'withdrawn') {
      return { price: null, status: 'withdrawn', currency: null, error: null };
    }

    if (price) {
      return { price, status, currency, error: null };
    }

    // Debug: log any amounts found
    const amountMatches = html.match(/[\$€£][\d,\.]+/g)?.slice(0, 5);
    console.log(`   ⚠️ No price pattern matched. Sample amounts: ${amountMatches?.join(', ') || 'none'}`);

    return { price: null, status: null, currency: null, error: 'No price pattern matched' };

  } catch (error) {
    if (error.name === 'TimeoutError') {
      return { price: null, status: null, currency: null, error: 'Timeout' };
    }
    return { price: null, status: null, currency: null, error: error.message?.slice(0, 100) };
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
      withdrawn: [],
      noSale: [],
      failed: [],
      skipped: []
    };

    // Filter to only BaT URLs (skip manual auctions and other sites)
    const batAuctions = auctions.filter(a =>
      a.url &&
      a.url.includes('bringatrailer.com') &&
      !a.auction_id?.startsWith('manual_')
    );

    console.log(`📋 Found ${batAuctions.length} BaT auctions to process (filtered from ${auctions.length})`);

    for (let i = 0; i < batAuctions.length; i++) {
      const auction = batAuctions[i];
      console.log(`\n[${i + 1}/${batAuctions.length}] ${auction.title?.slice(0, 60)}`);
      console.log(`   ID: ${auction.auction_id}`);

      if (!auction.url) {
        console.log('   ⏭️ Skipped: No URL');
        results.skipped.push({ id: auction.auction_id, reason: 'No URL' });
        continue;
      }

      const { price, status, currency, error } = await scrapeAuctionPrice(auction.url);

      // Handle withdrawn/cancelled auctions
      if (status === 'withdrawn') {
        // Mark with final_price = 0 so it won't be retried
        await supabase
          .from('auctions')
          .update({ final_price: 0 })
          .eq('auction_id', auction.auction_id);

        console.log(`   🚫 Marked as withdrawn`);
        results.withdrawn.push({
          id: auction.auction_id,
          title: auction.title
        });
        continue;
      }

      // Handle successful sale
      if (status === 'sold' && price && price > 0) {
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
          console.log(`   ✅ Updated: ${currency || 'USD'} ${price.toLocaleString()}`);
          results.successful.push({
            id: auction.auction_id,
            title: auction.title,
            finalPrice: price,
            currency: currency || 'USD'
          });
        }
        continue;
      }

      // Handle reserve not met
      if (status === 'no_sale') {
        // Mark with final_price = 0 so it won't be retried
        await supabase
          .from('auctions')
          .update({ final_price: 0 })
          .eq('auction_id', auction.auction_id);

        console.log(`   ⚠️ Reserve not met - marked with $0`);
        results.noSale.push({
          id: auction.auction_id,
          title: auction.title,
          highBid: price
        });
        continue;
      }

      // Failed to parse
      console.log(`   ❌ Failed: ${error}`);
      results.failed.push({
        id: auction.auction_id,
        title: auction.title,
        error: error
      });
    }

    // Summary
    const successCount = results.successful.length;
    const withdrawnCount = results.withdrawn.length;
    const noSaleCount = results.noSale.length;
    const failCount = results.failed.length;
    const skipCount = results.skipped.length;
    const total = successCount + withdrawnCount + noSaleCount + failCount + skipCount;
    const processedCount = successCount + withdrawnCount + noSaleCount;
    const successRate = total > 0 ? Math.round(processedCount / total * 100) : 0;

    console.log('\n' + '=' .repeat(50));
    console.log('📊 SUMMARY');
    console.log(`   ✅ Sold (updated):    ${successCount}`);
    console.log(`   🚫 Withdrawn:         ${withdrawnCount}`);
    console.log(`   ⚠️  Reserve not met:  ${noSaleCount}`);
    console.log(`   ❌ Failed:            ${failCount}`);
    console.log(`   ⏭️ Skipped:           ${skipCount}`);
    console.log(`   📈 Success rate:      ${successRate}%`);
    console.log('=' .repeat(50));

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processed: total,
      stats: {
        sold: successCount,
        withdrawn: withdrawnCount,
        noSale: noSaleCount,
        failed: failCount,
        skipped: skipCount
      },
      successful: successCount,
      failed: failCount,
      successRate,
      results: {
        successful: results.successful.slice(0, 10),
        withdrawn: results.withdrawn.slice(0, 10),
        noSale: results.noSale.slice(0, 10),
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
