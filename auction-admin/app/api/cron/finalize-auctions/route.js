import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { toCanonicalItem, canonicalUpsertListings } from '@/lib/canonicalStore';

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

// Target a row by auction_id when present, falling back to url for legacy
// rows inserted without one — updates filtered on a NULL auction_id match
// nothing, so those rows could never be finalized and were re-scraped forever.
function eqAuction(query, auction) {
  return auction.auction_id != null
    ? query.eq('auction_id', auction.auction_id)
    : query.eq('url', auction.url);
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
];

// Smallest believable car price/high bid. Anything below this is almost
// certainly a stray match against unrelated page text (e.g. a "$10/month"
// membership promo) rather than a real result, so we reject it. This is the
// JS equivalent of the `amount < 100` guard the python scraper already had.
const MIN_PLAUSIBLE_PRICE = 100;

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
    return price >= MIN_PLAUSIBLE_PRICE ? price : null;
  }

  // SOLD signals only. On BaT, "Sold for" / "Winning bid" mean the car sold.
  // NOTE: "Bid to X" does NOT belong here — it means the reserve was not met
  // (see highBidTextPatterns below).
  const saleTextPatterns = [
    { pattern: /Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Sold\s+for\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Sold\s+for\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Sold\s+for\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Sold\s+for\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Sold\s+for\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+£\s*([\d,]+)/i, currency: 'GBP' },
  ];

  // RESERVE-NOT-MET (no sale) signals. "Bid to X" is BaT's label for an auction
  // that ended without meeting reserve — X is the high bid, not a sale price.
  const highBidTextPatterns = [
    { pattern: /Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Bid\s+to\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Bid\s+to\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Bid\s+to\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Bid\s+to\s+€\s*([\d,\.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+£\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /High\s+Bid\s+EUR\s*€?\s*([\d,\.]+)/i, currency: 'EUR' },
    // Bounded gap ([^$]{0,40}) keeps this anchored to the bid shown next to the
    // "Reserve Not Met" label — the old `.*?` could leap across the whole page
    // and grab an unrelated amount (e.g. a "$10" promo).
    { pattern: /Reserve\s+Not\s+Met[^$]{0,40}\$\s*([\d,]+)/i, currency: 'USD' },
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

  // Pass 2: raw HTML text patterns
  const rawResult = matchText(html);
  if (rawResult) return rawResult;

  // Pass 3: strip all HTML tags, retry (handles price split across elements).
  // This MUST run before the bare <strong> fallback: BaT wraps the result
  // amount in a tag ("Bid to <strong>EUR €7,000</strong>"), so only the
  // stripped text reveals whether the amount is a sale price or a
  // reserve-not-met high bid.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
  const strippedResult = matchText(stripped);
  if (strippedResult) { console.log('   (matched after stripping HTML tags)'); return strippedResult; }

  // Pass 4: bare <strong>-wrapped amount. Ambiguous on its own — the same
  // markup carries both sale prices and reserve-not-met high bids — so check
  // the text immediately before the tag and only report 'sold' when nothing
  // marks the amount as a bid.
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
      if (!price) continue;
      const context = html
        .slice(Math.max(0, match.index - 300), match.index)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .slice(-80);
      if (/(?:bid\s+to|high\s+bid|current\s+bid|reserve\s+not\s+met)[\s:]*$/i.test(context)) {
        console.log(`   ⚠️ Found: ${currency} ${price.toLocaleString()} (reserve not met, via <strong>)`);
        return { price, status: 'no_sale', currency };
      }
      console.log(`   💰 Found: ${currency} ${price.toLocaleString()} (sold, via <strong>)`);
      return { price, status: 'sold', currency };
    }
  }

  // Pass 5: reserve not met with no extractable price
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

  // Explicit sale-price fields only. bid_amount/current_bid are NOT proof of
  // a sale — on a reserve-not-met listing they hold the losing high bid,
  // which is how "Bid to €7,000" listings used to get recorded as sold.
  const soldPrice =
    listing.sold_price ??
    listing.sale_price ??
    listing.final_price ??
    listing.auction_price ??
    listing.winning_bid;

  const highBid = listing.bid_amount ?? listing.current_bid;

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

  if (isRnm) {
    const bid = Number(highBid ?? soldPrice);
    if (bid >= MIN_PLAUSIBLE_PRICE) {
      console.log(`   ⚠️ __NEXT_DATA__: ${currency} ${bid.toLocaleString()} (reserve not met)`);
      return { price: parseInt(bid, 10), status: 'no_sale', currency };
    }
    console.log('   ⚠️ __NEXT_DATA__: reserve not met (no price)');
    return { price: null, status: 'no_sale', currency: null };
  }

  if (soldPrice && Number(soldPrice) >= MIN_PLAUSIBLE_PRICE) {
    const price = parseInt(soldPrice, 10);
    console.log(`   💰 __NEXT_DATA__: ${currency} ${price.toLocaleString()} (sold)`);
    return { price, status: 'sold', currency };
  }

  // Only a bid amount and no positive sold/RNM signal — inconclusive. Fall
  // through to the HTML text passes, which can read the "Sold for"/"Bid to"
  // label next to the amount.
  console.log(`   📦 __NEXT_DATA__ inconclusive: status=${listing.status} sold_price=${listing.sold_price} bid_amount=${listing.bid_amount}`);
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
 * Extract engagement stats (MII components) from a BaT listing page:
 * bid_count, views, watchers, comments. Tries __NEXT_DATA__ first, then the
 * visible listing-stats text ("12,345 views", "678 watchers", "18 bids",
 * "203 comments"). Returns only the fields actually found — possibly {}.
 */
function extractEngagementStats(html) {
  const pick = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (v != null && Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return null;
  };

  const stats = {};
  const listing = parseNextDataListing(html);
  if (listing) {
    stats.views = pick(listing.views, listing.view_count, listing.stats?.views);
    stats.watchers = pick(listing.watchers, listing.watcher_count, listing.stats?.watchers);
    stats.bid_count = pick(listing.bid_count, listing.num_bids, listing.bids_count);
    stats.comments = pick(listing.comments_count, listing.comment_count, listing.num_comments);
  }

  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
  const grab = (re) => {
    const m = stripped.match(re);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  if (stats.views == null) stats.views = grab(/([\d,]+)\s+views/i);
  if (stats.watchers == null) stats.watchers = grab(/([\d,]+)\s+watchers/i);
  if (stats.bid_count == null) stats.bid_count = grab(/([\d,]+)\s+bids\b/i);
  if (stats.comments == null) stats.comments = grab(/([\d,]+)\s+comments\b/i);

  Object.keys(stats).forEach((k) => stats[k] == null && delete stats[k]);
  return stats;
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
    // Always try to extract make/model + engagement stats regardless of price result
    const makeModel = extractMakeModelFromNextData(html);
    const engagement = extractEngagementStats(html);
    if (nextDataResult) return { ...nextDataResult, makeModel, engagement, error: null };

    // Passes 1-4: regex-based HTML extraction
    const { price, status, currency } = extractPriceFromHtml(html);
    if (price || status === 'no_sale') {
      return { price, status, currency, makeModel, engagement, error: null };
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

    return { price: null, status: null, currency: null, makeModel, engagement, error: 'No price found' };

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
      // Key by url when auction_id is null so distinct legacy rows aren't
      // collapsed into one by a shared null key.
      const key = a.auction_id ?? a.url;
      if (!seen.has(key)) {
        seen.add(key);
        auctions.push(a);
      }
    }

    if (auctions.length === 0) {
      console.log('📭 No auctions need finalization');
      return NextResponse.json({ success: true, message: 'No auctions to finalize', processed: 0 });
    }

    console.log(`📋 Found ${auctions.length} BaT auctions to process`);

    const results = { successful: [], noSale: [], pending: [], skipped: [] };
    const canonicalItems = []; // Phase 2 dual-write; no-op unless configured

    for (let i = 0; i < auctions.length; i++) {
      const auction = auctions[i];
      console.log(`\n[${i + 1}/${auctions.length}] ${auction.title?.slice(0, 60)}`);
      console.log(`   ID: ${auction.auction_id}`);

      if (!auction.url) {
        console.log('   ⏭️ Skipped: No URL');
        results.skipped.push({ id: auction.auction_id, reason: 'No URL' });
        continue;
      }

      const { price, status, currency, makeModel, engagement = {}, error } = await scrapeAuctionPrice(auction.url);

      // Persist engagement stats (bids/views/watchers/comments) in a separate
      // update so a missing column (migration not run yet) can never block
      // price finalization.
      if (Object.keys(engagement).length > 0) {
        const { error: statsError } = await eqAuction(
          supabase.from('auctions').update(engagement), auction
        );
        if (statsError) {
          console.log(`   ⚠️ Engagement stats not saved (${statsError.message}) — run supabase_migration_engagement_stats.sql`);
        } else {
          console.log(`   📊 Stats: ${engagement.bid_count ?? '—'} bids · ${engagement.views ?? '—'} views · ${engagement.watchers ?? '—'} watchers · ${engagement.comments ?? '—'} comments`);
        }
      }

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
        const { error: updateError } = await eqAuction(
          supabase
            .from('auctions')
            .update({ final_price: price, reserve_not_met: false, ...makeModelUpdate }),
          auction
        );

        if (updateError) {
          console.log(`   ❌ DB update failed: ${updateError.message}`);
          results.pending.push({ id: auction.auction_id, title: auction.title, error: updateError.message });
        } else {
          console.log(`   ✅ Sold: ${currency || 'USD'} ${price.toLocaleString()}`);
          results.successful.push({ id: auction.auction_id, title: auction.title, finalPrice: price, currency: currency || 'USD' });
          canonicalItems.push(toCanonicalItem({
            ...auction, ...makeModelUpdate, ...engagement,
            final_price: price, reserve_not_met: false, currency: currency || 'USD',
          }));
        }
        continue;
      }

      if (status === 'no_sale') {
        // final_price: null clears any stale 0 value left by old withdrawn-detection code
        const updateData = { reserve_not_met: true, final_price: null, ...makeModelUpdate };
        if (price) {
          updateData.current_bid = price;
        } else if (auction.current_bid != null && Number(auction.current_bid) < MIN_PLAUSIBLE_PRICE) {
          // No real high bid found and the stored value is an implausible
          // placeholder (e.g. the legacy "$10") — clear it so the app stops
          // showing a bogus high bid and scoring falls back sensibly.
          updateData.current_bid = null;
        }
        await eqAuction(supabase.from('auctions').update(updateData), auction);
        console.log(`   ⚠️ Reserve not met${price ? ` — high bid ${price.toLocaleString()}` : ''}`);
        results.noSale.push({ id: auction.auction_id, title: auction.title, highBid: price || null });
        canonicalItems.push(toCanonicalItem({
          ...auction, ...makeModelUpdate, ...engagement,
          final_price: null, reserve_not_met: true,
          current_bid: price ?? auction.current_bid, currency: currency || undefined,
        }));
        continue;
      }

      // No definitive price result — but still persist make/model if we found them
      if (Object.keys(makeModelUpdate).length > 0) {
        await eqAuction(supabase.from('auctions').update(makeModelUpdate), auction);
      }

      // Leave final_price NULL, retry next run
      console.log(`   🔄 Pending: ${error || 'no price found yet'}`);
      results.pending.push({ id: auction.auction_id, title: auction.title, error: error || 'no price found' });
    }

    const canonical = await canonicalUpsertListings(canonicalItems);

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
      canonicalMirror: canonical,
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
