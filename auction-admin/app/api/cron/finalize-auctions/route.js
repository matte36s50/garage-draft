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
 *
 * OUTCOMES per auction:
 *   Sold           → sets final_price
 *   Reserve Not Met → sets reserve_not_met = true (keeps final_price NULL for scoring)
 *   Anything else  → no DB change, retries next run
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
];

/**
 * Extract final price from BaT HTML via regex.
 * Only returns 'sold' or 'no_sale' — never 'withdrawn'.
 * If neither signal is found, returns { price: null, status: null }.
 */
function extractPriceFromHtml(html) {
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

  // Pass 1: meta description / og:description (plain text, most reliable)
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

  // Pass 2: raw HTML text patterns + <strong> tag patterns
  const rawResult = matchText(html);
  if (rawResult) return rawResult;

  const strongPatterns = [
    { pattern: /<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*<\/strong>/i, currency: 'USD' },
    { pattern: /<strong>\s*EUR\s*€?\s*([\d,\.]+)\s*<\/strong>/i, currency: 'EUR' },
    { pattern: /<strong>\s*GBP\s*£?\s*([\d,]+)\s*<\/strong>/i, currency: 'GBP' },
    { pattern: /<strong>\s*CAD\s*\$?\s*([\d,]+)\s*<\/strong>/i, currency: 'CAD' },
    { pattern: /<strong>\s*AUD\s*\$?\s*([\d,]+)\s*<\/strong>/i, currency: 'AUD' },
  ];
  for (const { pattern, currency } of strongPatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parsePrice(match[1], currency);
      if (price) {
        console.log(`   💰 Found: ${currency} ${price.toLocaleString()} (sold, via <strong>)`);
        return { price, status: 'sold', currency };
      }
    }
  }

  // Pass 3: strip all HTML tags, retry (handles price split across elements)
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
  const strippedResult = matchText(stripped);
  if (strippedResult) { console.log('   (matched after stripping HTML tags)'); return strippedResult; }

  // Pass 4: reserve not met with no extractable price
  if (/reserve\s+not\s+met/i.test(stripped)) {
    console.log('   ⚠️ Detected: Reserve Not Met (no price found)');
    return { price: null, status: 'no_sale', currency: null };
  }

  return { price: null, status: null, currency: null };
}

/**
 * Parse the __NEXT_DATA__ JSON blob embedded in a BaT page.
 * Returns the parsed listing object or null.
 */
function parseNextDataListing(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return data?.props?.pageProps?.listing ?? null;
  } catch {
    return null;
  }
}

/**
 * Try to extract price from BaT's embedded __NEXT_DATA__ JSON blob.
 * Returns { price, status, currency } or null if inconclusive.
 */
function extractPriceFromNextData(html) {
  const listing = parseNextDataListing(html);
  if (!listing) {
    const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const pagePropsKeys = Object.keys(data?.props?.pageProps || {});
        console.log(`   📦 __NEXT_DATA__ pageProps keys: ${pagePropsKeys.join(', ')}`);
      } catch { /* ignore */ }
    }
    return null;
  }

  const listingKeys = Object.keys(listing);
  console.log(`   📦 __NEXT_DATA__ listing keys: ${listingKeys.slice(0, 20).join(', ')}`);

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

  console.log(`   📦 __NEXT_DATA__ status=${listing.status} sold_price=${listing.sold_price} bid_amount=${listing.bid_amount}`);
  return null;
}

/**
 * Extract make, model, and year from a BaT listing's __NEXT_DATA__ JSON blob.
 * Returns { make, model, year } with any found fields, or null if nothing useful found.
 */
function extractMakeModelFromNextData(html) {
  const listing = parseNextDataListing(html);
  if (!listing) return null;

  const year = listing.year ?? listing.model_year ?? listing.vehicle_year ?? null;
  const make = listing.make ?? listing.manufacturer ?? listing.vehicle_make ?? null;
  const model =
    listing.model ??
    listing.model_name ??
    listing.vehicle_model ??
    listing.specs?.model ??
    null;

  if (!make && !model && !year) return null;

  return {
    year: year ? parseInt(year, 10) : null,
    make: make ? String(make).trim() : null,
    model: model ? String(model).trim() : null,
  };
}

/**
 * Fetch a BaT listing page and return { price, status, currency, error }.
 * status is 'sold', 'no_sale', or null (= inconclusive, retry next run).
 */
async function scrapeAuctionPrice(url) {
  try {
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

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

    if (!response.ok) {
      return { price: null, status: null, currency: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Cloudflare challenge page — 200 OK but no real content
    if (
      /Just a moment\.\.\./i.test(html) ||
      /Checking your browser before accessing/i.test(html) ||
      /cf-browser-verification/i.test(html) ||
      /_cf_chl_opt\s*=/i.test(html) ||
      /challenge-platform\/h\/[bg]/i.test(html)
    ) {
      console.log('   🛡️ Cloudflare challenge page detected');
      return { price: null, status: null, currency: null, error: 'Cloudflare blocked' };
    }

    // Pass 0: __NEXT_DATA__ JSON (most reliable)
    const nextDataResult = extractPriceFromNextData(html);
    // Always try to extract make/model from __NEXT_DATA__ regardless of price result
    const makeModel = extractMakeModelFromNextData(html);
    if (nextDataResult) return { ...nextDataResult, makeModel, error: null };

    // Passes 1-4: regex-based HTML extraction
    const { price, status, currency } = extractPriceFromHtml(html);
    if (price || status === 'no_sale') {
      return { price, status, currency, makeModel, error: null };
    }

    // Nothing found — log debug info and retry next run
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
    const soldContext = stripped.match(/.{0,80}sold.{0,80}/i)?.[0]?.replace(/\s+/g, ' ');
    const amountMatches = stripped.match(/[\$€£][\d,\.]+/g)?.slice(0, 5);
    const pageTitle = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1];
    console.log(`   ⚠️ No price found — will retry next run`);
    console.log(`      Page title: ${pageTitle || 'none'}`);
    console.log(`      Sold context: ${soldContext || 'none'}`);
    console.log(`      Sample amounts: ${amountMatches?.join(', ') || 'none'}`);
    console.log(`      HTML length: ${html.length} chars`);

    return { price: null, status: null, currency: null, makeModel, error: 'No price found' };

  } catch (error) {
    if (error.name === 'TimeoutError') {
      return { price: null, status: null, currency: null, makeModel: null, error: 'Timeout' };
    }
    return { price: null, status: null, currency: null, makeModel: null, error: error.message?.slice(0, 100) };
  }
}

export async function GET(request) {
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
  return runFinalizer({ minAgeMinutes: 5 });
}

async function runFinalizer({ minAgeMinutes = 120 } = {}) {
  const supabase = getSupabaseClient();

  console.log('='.repeat(50));
  console.log('🚀 Auction Finalizer - Starting');
  console.log(`🕐 Time: ${new Date().toISOString()}`);
  console.log(`⏱️ Min age: ${minAgeMinutes} minutes`);
  console.log('='.repeat(50));

  try {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - (minAgeMinutes * 60);

    // Auctions ended > minAgeMinutes ago, no final price, not already flagged RNM
    const { data: unfinalized, error: fetchError } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end, make, model, year')
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

    // Re-check reserve_not_met auctions from the last 30 days — the scraper may
    // have flagged RNM before BaT finalized the result and a sale could have gone through.
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
    const { data: recheck } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end, make, model, year')
      .lt('timestamp_end', cutoff)
      .gte('timestamp_end', thirtyDaysAgo)
      .is('final_price', null)
      .is('reserve_not_met', true)
      .not('url', 'is', null)
      .ilike('url', '%bringatrailer.com%')
      .order('timestamp_end', { ascending: false })
      .limit(10);

    // Re-scrape "suspicious withdrawn" auctions (final_price=0, had bids).
    // Old lambda code used to set final_price=0 for detected withdrawals, but that
    // regex was too aggressive and caught sold/RNM auctions. These are invisible to
    // the normal finalizer query (which filters on final_price IS NULL), so we
    // re-scrape them here to reclassify properly: sold → set real price,
    // RNM → flip to reserve_not_met=true/final_price=null.
    const { data: suspiciousWithdrawn } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end, make, model, year')
      .lt('timestamp_end', cutoff)
      .gte('timestamp_end', thirtyDaysAgo)
      .eq('final_price', 0)
      .gt('current_bid', 0)
      .not('url', 'is', null)
      .ilike('url', '%bringatrailer.com%')
      .order('timestamp_end', { ascending: false })
      .limit(20);

    const seen = new Set();
    const auctions = [];
    for (const a of [...(unfinalized || []), ...(recheck || []), ...(suspiciousWithdrawn || [])]) {
      if (!seen.has(a.auction_id)) {
        seen.add(a.auction_id);
        auctions.push(a);
      }
    }

    if (auctions.length === 0) {
      console.log('📭 No auctions need finalization');
      return NextResponse.json({ success: true, message: 'No auctions to finalize', processed: 0 });
    }

    console.log(`📋 Found ${auctions.length} BaT auctions to process`);

    const results = { successful: [], noSale: [], pending: [], skipped: [] };

    for (let i = 0; i < auctions.length; i++) {
      const auction = auctions[i];
      console.log(`\n[${i + 1}/${auctions.length}] ${auction.title?.slice(0, 60)}`);
      console.log(`   ID: ${auction.auction_id}`);

      if (!auction.url) {
        console.log('   ⏭️ Skipped: No URL');
        results.skipped.push({ id: auction.auction_id, reason: 'No URL' });
        continue;
      }

      const { price, status, currency, makeModel, error } = await scrapeAuctionPrice(auction.url);

      // Build opportunistic make/model/year fields — only fill nulls, never overwrite existing data
      const makeModelUpdate = {};
      if (makeModel) {
        if (makeModel.make && !auction.make) makeModelUpdate.make = makeModel.make;
        if (makeModel.model && !auction.model) makeModelUpdate.model = makeModel.model;
        if (makeModel.year && !auction.year) makeModelUpdate.year = makeModel.year;
        if (Object.keys(makeModelUpdate).length > 0) {
          console.log(`   🏷️ Make/model: ${makeModelUpdate.make || '—'} / ${makeModelUpdate.model || '—'} / ${makeModelUpdate.year || '—'}`);
        }
      }

      if (status === 'sold' && price > 0) {
        const { error: updateError } = await supabase
          .from('auctions')
          .update({ final_price: price, reserve_not_met: false, ...makeModelUpdate })
          .eq('auction_id', auction.auction_id);

        if (updateError) {
          console.log(`   ❌ DB update failed: ${updateError.message}`);
          results.pending.push({ id: auction.auction_id, title: auction.title, error: updateError.message });
        } else {
          console.log(`   ✅ Sold: ${currency || 'USD'} ${price.toLocaleString()}`);
          results.successful.push({ id: auction.auction_id, title: auction.title, finalPrice: price, currency: currency || 'USD' });
        }
        continue;
      }

      if (status === 'no_sale') {
        // final_price: null clears any stale 0 value left by old withdrawn-detection code
        const updateData = { reserve_not_met: true, final_price: null, ...makeModelUpdate };
        if (price) updateData.current_bid = price;
        await supabase.from('auctions').update(updateData).eq('auction_id', auction.auction_id);
        console.log(`   ⚠️ Reserve not met${price ? ` — high bid ${price.toLocaleString()}` : ''}`);
        results.noSale.push({ id: auction.auction_id, title: auction.title, highBid: price || null });
        continue;
      }

      // No definitive price result — but still persist make/model if we found them
      if (Object.keys(makeModelUpdate).length > 0) {
        await supabase.from('auctions').update(makeModelUpdate).eq('auction_id', auction.auction_id);
      }

      // Leave final_price NULL, retry next run
      console.log(`   🔄 Pending: ${error || 'no price found yet'}`);
      results.pending.push({ id: auction.auction_id, title: auction.title, error: error || 'no price found' });
    }

    const successCount = results.successful.length;
    const noSaleCount = results.noSale.length;
    const pendingCount = results.pending.length;
    const skipCount = results.skipped.length;
    const total = successCount + noSaleCount + pendingCount + skipCount;
    const resolvedCount = successCount + noSaleCount;
    const successRate = total > 0 ? Math.round(resolvedCount / total * 100) : 0;

    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY');
    console.log(`   ✅ Sold (updated):    ${successCount}`);
    console.log(`   ⚠️  Reserve not met:  ${noSaleCount}`);
    console.log(`   🔄 Pending (retry):   ${pendingCount}`);
    console.log(`   ⏭️ Skipped:           ${skipCount}`);
    console.log(`   📈 Resolved rate:     ${successRate}%`);
    console.log('='.repeat(50));

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processed: total,
      stats: { sold: successCount, noSale: noSaleCount, pending: pendingCount, skipped: skipCount },
      successRate,
      results: {
        successful: results.successful.slice(0, 10),
        noSale: results.noSale.slice(0, 10),
        pending: results.pending.slice(0, 10),
      }
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
