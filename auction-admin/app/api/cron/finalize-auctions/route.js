import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * AUCTION FINALIZER CRON JOB
 *
 * Scrapes BringATrailer pages to get final sale prices for ended auctions.
 *
 * SCHEDULING — add this to the same external cron service (cron-job.org, etc.)
 * you already use for update-performance:
 *   URL:      https://bid-prix-admin.vercel.app/api/cron/finalize-auctions
 *   Method:   GET
 *   Schedule: Every 30 minutes  (0,30 * * * *)
 *   Header:   Authorization: Bearer <CRON_SECRET>   (if CRON_SECRET env var is set)
 *
 * Manual trigger from admin UI: POST /api/cron/finalize-auctions (no auth needed)
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
 *
 * Strategy (in order):
 * 1. Check og:description / meta description (plain text, most reliable)
 * 2. Match against raw HTML (handles simple inline text and <strong> tags)
 * 3. Strip all HTML tags, then match (handles price split across elements)
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

  // Parse a raw price string to an integer, handling locale formats
  function parsePrice(priceStr, currency) {
    if (currency === 'EUR' && priceStr.includes('.') && priceStr.includes(',')) {
      priceStr = priceStr.replace(/\./g, '').replace(',', '.');
    } else if (currency === 'CHF') {
      priceStr = priceStr.replace(/'/g, '');
    }
    priceStr = priceStr.replace(/,/g, '');
    if (priceStr.includes('.')) priceStr = priceStr.split('.')[0];
    const price = parseInt(priceStr, 10);
    return price > 0 ? price : null;
  }

  // Text-only sale patterns (applied to plain text / stripped HTML)
  const saleTextPatterns = [
    { pattern: /Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Sold\s+for\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Sold\s+for\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Bid\s+to\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Sold\s+for\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Bid\s+to\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Sold\s+for\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Bid\s+to\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Sold\s+for\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+£\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+£\s*([\d,]+)/i, currency: 'GBP' },
  ];

  const highBidTextPatterns = [
    { pattern: /High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /High\s+Bid\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Reserve\s+Not\s+Met.*?\$\s*([\d,]+)/i, currency: 'USD' },
  ];

  function matchText(text) {
    for (const { pattern, currency } of saleTextPatterns) {
      const match = text.match(pattern);
      if (match) {
        const price = parsePrice(match[1], currency);
        if (price) {
          console.log(`   💰 Found: ${currency} ${price.toLocaleString()} (sold)`);
          return { price, status: 'sold', currency };
        }
      }
    }
    for (const { pattern, currency } of highBidTextPatterns) {
      const match = text.match(pattern);
      if (match) {
        const price = parsePrice(match[1], currency);
        if (price) {
          console.log(`   ⚠️ Found: ${currency} ${price.toLocaleString()} (reserve not met)`);
          return { price, status: 'no_sale', currency };
        }
      }
    }
    return null;
  }

  // --- Pass 1: meta description / og:description (plain text, no tag noise) ---
  const metaRegexes = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)[^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)[^>]+name=["']description["']/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)[^>]+name=["']twitter:description["']/i,
  ];
  for (const regex of metaRegexes) {
    const m = html.match(regex);
    if (m) {
      const result = matchText(m[1]);
      if (result) { console.log('   (matched via meta tag)'); return result; }
    }
  }

  // --- Pass 2: raw HTML (handles inline text and <strong> wrapping) ---
  // Also add <strong>-specific patterns for cases where "Sold for" text and
  // the price are split by a tag boundary.
  const rawHtmlPatterns = [
    { pattern: /<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*<\/strong>/i, currency: 'USD' },
    { pattern: /<strong>\s*EUR\s*€?\s*([\d,\.]+)\s*<\/strong>/i, currency: 'EUR' },
    { pattern: /<strong>\s*GBP\s*£?\s*([\d,]+)\s*<\/strong>/i, currency: 'GBP' },
    { pattern: /<strong>\s*CAD\s*\$?\s*([\d,]+)\s*<\/strong>/i, currency: 'CAD' },
    { pattern: /<strong>\s*AUD\s*\$?\s*([\d,]+)\s*<\/strong>/i, currency: 'AUD' },
  ];
  // Try text patterns on raw HTML first (works when price is plain inline text)
  const rawResult = matchText(html);
  if (rawResult) return rawResult;
  // Then try strong-tag patterns
  for (const { pattern, currency } of rawHtmlPatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parsePrice(match[1], currency);
      if (price) {
        console.log(`   💰 Found: ${currency} ${price.toLocaleString()} (sold, via <strong>)`);
        return { price, status: 'sold', currency };
      }
    }
  }

  // --- Pass 3: strip all HTML tags, retry text patterns ---
  // Handles prices split across multiple elements, e.g.:
  //   "Sold for <span>USD</span> <strong>$32,944</strong>"
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
  const strippedResult = matchText(stripped);
  if (strippedResult) { console.log('   (matched after stripping HTML tags)'); return strippedResult; }

  // --- Pass 4: reserve not met with no extractable price ---
  // Broad Arrow and other non-standard BaT-hosted auctions may show
  // "Reserve Not Met" without the high bid in a parseable format.
  // Mark as no_sale so the auction is resolved and removed from the queue.
  if (/reserve\s+not\s+met/i.test(stripped)) {
    console.log('   ⚠️ Detected: Reserve Not Met (no price found)');
    return { price: null, status: 'no_sale', currency: null };
  }

  return { price: null, status: null, currency: null };
}

/**
 * Try to extract price from BaT's embedded __NEXT_DATA__ JSON blob.
 * Returns { price, status, currency } or null if not found / not applicable.
 */
function extractPriceFromNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
  if (!match) return null;

  let nextData;
  try {
    nextData = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const listing = nextData?.props?.pageProps?.listing;
  if (!listing) {
    // Log top-level keys so we can see the structure in Vercel logs
    const pagePropsKeys = Object.keys(nextData?.props?.pageProps || {});
    console.log(`   📦 __NEXT_DATA__ pageProps keys: ${pagePropsKeys.join(', ')}`);
    return null;
  }

  // Log listing keys once so we can see BaT's field names in logs
  const listingKeys = Object.keys(listing);
  console.log(`   📦 __NEXT_DATA__ listing keys: ${listingKeys.slice(0, 20).join(', ')}`);

  // BaT field names (try all plausible variants)
  const soldPrice =
    listing.sold_price ??
    listing.sale_price ??
    listing.final_price ??
    listing.auction_price ??
    listing.bid_amount ??
    listing.winning_bid ??
    listing.current_bid;

  const currency = (
    listing.currency ||
    listing.sold_currency ||
    listing.bid_currency ||
    'USD'
  ).toUpperCase();

  const isRnm = !!(
    listing.reserve_not_met ||
    listing.no_sale ||
    listing.status === 'no_sale' ||
    listing.reserve_status === 'not_met' ||
    listing.reserve_status === 'no_sale'
  );

  const isWithdrawn = !!(
    listing.withdrawn ||
    listing.cancelled ||
    listing.status === 'withdrawn' ||
    listing.status === 'cancelled'
  );

  if (isWithdrawn) {
    console.log('   🚫 __NEXT_DATA__: listing withdrawn');
    return { price: null, status: 'withdrawn', currency: null };
  }

  if (soldPrice && soldPrice > 0) {
    const price = parseInt(soldPrice, 10);
    if (isRnm) {
      console.log(`   ⚠️ __NEXT_DATA__: ${currency} ${price.toLocaleString()} (reserve not met)`);
      return { price, status: 'no_sale', currency };
    }
    console.log(`   💰 __NEXT_DATA__: ${currency} ${price.toLocaleString()} (sold)`);
    return { price, status: 'sold', currency };
  }

  if (isRnm) {
    console.log('   ⚠️ __NEXT_DATA__: reserve not met (no price)');
    return { price: null, status: 'no_sale', currency: null };
  }

  // Have __NEXT_DATA__ but no conclusive result — log status/bid fields for debugging
  console.log(`   📦 __NEXT_DATA__ status=${listing.status} sold_price=${listing.sold_price} bid_amount=${listing.bid_amount}`);
  return null;
}

/**
 * Scrape a single BaT auction page
 */
async function scrapeAuctionPrice(url) {
  try {
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

    // Full browser headers to reduce Cloudflare blocking
    const headers = {
      'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    };

    console.log(`   🌐 Fetching: ${url}`);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (response.status === 403) {
      return { price: null, status: null, currency: null, error: '403 Forbidden - blocked' };
    }

    if (response.status === 404) {
      // Don't mark as withdrawn — BaT sometimes 404s on valid ended listings.
      // Leave final_price NULL so the next cron run retries.
      return { price: null, status: null, currency: null, error: '404 Not Found' };
    }

    if (!response.ok) {
      return { price: null, status: null, currency: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Detect Cloudflare bot challenge (returns 200 OK but serves a JS challenge page)
    if (
      /Just a moment\.\.\./i.test(html) ||
      /Checking your browser before accessing/i.test(html) ||
      /cf-browser-verification/i.test(html) ||
      /_cf_chl_opt\s*=/i.test(html) ||
      /challenge-platform\/h\/[bg]/i.test(html)
    ) {
      console.log('   🛡️ Cloudflare challenge page detected — scraper IP is blocked');
      return { price: null, status: null, currency: null, error: 'Cloudflare blocked' };
    }

    // Pass 0: __NEXT_DATA__ JSON (structured data, most reliable when present)
    const nextDataResult = extractPriceFromNextData(html);
    if (nextDataResult) {
      return { ...nextDataResult, error: null };
    }

    // Passes 1-4: regex-based HTML extraction (fallback)
    const { price, status, currency } = extractPriceFromHtml(html);

    if (status === 'withdrawn') {
      return { price: null, status: 'withdrawn', currency: null, error: null };
    }

    if (price) {
      return { price, status, currency, error: null };
    }

    // Debug: log context around "sold" to help diagnose format changes
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
    const soldContext = stripped.match(/.{0,80}sold.{0,80}/i)?.[0]?.replace(/\s+/g, ' ');
    const amountMatches = stripped.match(/[\$€£][\d,\.]+/g)?.slice(0, 5);
    const pageTitle = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1];
    console.log(`   ⚠️ No price pattern matched.`);
    console.log(`      Page title: ${pageTitle || 'none'}`);
    console.log(`      Sold context: ${soldContext || 'none'}`);
    console.log(`      Sample amounts: ${amountMatches?.join(', ') || 'none'}`);
    console.log(`      HTML length: ${html.length} chars`);

    return { price: null, status: null, currency: null, error: 'No price pattern matched' };

  } catch (error) {
    if (error.name === 'TimeoutError') {
      return { price: null, status: null, currency: null, error: 'Timeout' };
    }
    return { price: null, status: null, currency: null, error: error.message?.slice(0, 100) };
  }
}

export async function GET(request) {
  // Verify cron secret for security (only for GET - external cron calls)
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

  return runFinalizer();
}

// POST doesn't require auth - called from admin UI which is already protected
export async function POST(request) {
  // Manual admin trigger: only skip auctions that ended in the last 5 minutes
  // (BaT updates pages within minutes of auction end, so no need for 2-hour wait)
  return runFinalizer({ minAgeMinutes: 5 });
}

async function runFinalizer({ minAgeMinutes = 120 } = {}) {
  const supabase = getSupabaseClient();

  console.log('=' .repeat(50));
  console.log('🚀 Auction Finalizer - Starting');
  console.log(`🕐 Time: ${new Date().toISOString()}`);
  console.log(`⏱️ Min age: ${minAgeMinutes} minutes`);
  console.log('=' .repeat(50));

  try {
    // Get auctions that ended more than minAgeMinutes ago but have no final_price
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - (minAgeMinutes * 60);

    // Auctions that ended > minAgeMinutes ago, have no final price, and haven't been confirmed RNM.
    // Use `not('reserve_not_met', 'is', true)` instead of `.eq('reserve_not_met', false)` so that
    // rows where reserve_not_met IS NULL are also included (NULL = false is NULL in SQL, not TRUE).
    const { data: unfinalized, error: fetchError } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end')
      .lt('timestamp_end', cutoff)
      .is('final_price', null)
      .not('reserve_not_met', 'is', true)
      .not('url', 'is', null)
      .ilike('url', '%bringatrailer.com%')
      .order('timestamp_end', { ascending: false })
      .limit(200);

    if (fetchError) {
      console.error('Error fetching auctions:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Also re-check auctions flagged reserve_not_met within the last 30 days —
    // the scraper may have caught the page before BaT finalized the sale result.
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
    const { data: recheck, error: recheckError } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end')
      .lt('timestamp_end', cutoff)
      .gte('timestamp_end', thirtyDaysAgo)
      .is('final_price', null)
      .is('reserve_not_met', true)
      .not('url', 'is', null)
      .order('timestamp_end', { ascending: false })
      .limit(10);

    const seen = new Set();
    const auctions = [];
    for (const a of [...(unfinalized || []), ...(recheck || [])]) {
      if (!seen.has(a.auction_id)) {
        seen.add(a.auction_id);
        auctions.push(a);
      }
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

    // DB query already filters to bringatrailer.com URLs only.
    const batAuctions = auctions || [];

    console.log(`📋 Found ${batAuctions.length} BaT auctions to process`);

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
          .update({ final_price: price, reserve_not_met: false })
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

      // Handle reserve not met - flag reserve_not_met so this auction is
      // permanently resolved and won't reappear in the Finalize tab.
      // final_price stays NULL so scoring applies the 25% penalty correctly.
      // If we have a high bid price, also update current_bid for scoring.
      if (status === 'no_sale') {
        const updateData = { reserve_not_met: true };
        if (price) updateData.current_bid = price;

        await supabase
          .from('auctions')
          .update(updateData)
          .eq('auction_id', auction.auction_id);

        console.log(`   ⚠️ Reserve not met${price ? ` - updated current_bid to ${price.toLocaleString()}` : ' (no price found)'}`);
        results.noSale.push({
          id: auction.auction_id,
          title: auction.title,
          highBid: price || null
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
