import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * INVESTIGATE A SINGLE AUCTION
 *
 * Step 1 of methodical cleanup: compare what the DB says about an auction
 * with what BaT actually shows. Used to spot-check whether suspicious
 * withdrawn rows are really sold, RNM, withdrawn, or something else.
 *
 * GET /api/admin/investigate-auction?auction_id=<id>
 *
 * Returns:
 *   db:   current row values (url, current_bid, final_price, reserve_not_met)
 *   bat:  what we can extract from the BaT page right now
 *           verdict: 'sold' | 'no_sale' | 'withdrawn' | 'inconclusive'
 *           price, currency, signals[], error, http_status, html_length
 *   discrepancy: short human-readable diff, or null if they agree
 *
 * No auth: only reachable through the gated admin UI.
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';

function parsePrice(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fromNextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const listing = data?.props?.pageProps?.listing;
  if (!listing) return null;

  const soldPrice = listing.sold_price ?? listing.sale_price ?? listing.final_price ?? listing.winning_bid;
  const highBid = listing.current_bid ?? listing.bid_amount ?? listing.high_bid;
  const currency = (listing.currency || listing.sold_currency || 'USD').toUpperCase();
  const isRnm = !!(
    listing.reserve_not_met ||
    listing.no_sale ||
    listing.status === 'no_sale' ||
    listing.reserve_status === 'not_met'
  );
  const isWithdrawn = listing.status === 'withdrawn' || listing.status === 'cancelled';

  if (isWithdrawn) {
    return { source: '__NEXT_DATA__.listing.status', verdict: 'withdrawn', price: null, currency: null, raw: { status: listing.status } };
  }
  if (soldPrice && soldPrice > 0) {
    if (isRnm) {
      return { source: '__NEXT_DATA__.listing', verdict: 'no_sale', price: parseInt(soldPrice, 10), currency, raw: { sold_price: soldPrice, reserve_not_met: true } };
    }
    return { source: '__NEXT_DATA__.listing.sold_price', verdict: 'sold', price: parseInt(soldPrice, 10), currency, raw: { sold_price: soldPrice } };
  }
  if (isRnm) {
    return { source: '__NEXT_DATA__.listing', verdict: 'no_sale', price: highBid ? parseInt(highBid, 10) : null, currency, raw: { reserve_not_met: true, high_bid: highBid } };
  }
  return { source: '__NEXT_DATA__.listing', verdict: 'inconclusive', price: null, currency: null, raw: { status: listing.status, sold_price: listing.sold_price, bid_amount: listing.bid_amount } };
}

function fromMetaTag(html) {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
  if (!m) return null;
  const text = m[1];
  const sold = text.match(/Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i);
  if (sold) return { source: 'og:description', verdict: 'sold', price: parsePrice(sold[1]), currency: 'USD', raw: { matched: text.slice(0, 200) } };
  if (/reserve\s+not\s+met/i.test(text)) {
    const bid = text.match(/(?:high\s+bid|bid\s+to)\s+(?:USD\s+)?\$\s*([\d,]+)/i);
    return { source: 'og:description', verdict: 'no_sale', price: bid ? parsePrice(bid[1]) : null, currency: 'USD', raw: { matched: text.slice(0, 200) } };
  }
  if (/withdrawn|cancelled/i.test(text)) {
    return { source: 'og:description', verdict: 'withdrawn', price: null, currency: null, raw: { matched: text.slice(0, 200) } };
  }
  return null;
}

function fromRawHtml(html) {
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const sold = stripped.match(/Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i);
  if (sold) return { source: 'raw-html-sold', verdict: 'sold', price: parsePrice(sold[1]), currency: 'USD', raw: { snippet: sold[0] } };
  const bidTo = stripped.match(/Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)/i);
  if (bidTo && /reserve\s+not\s+met/i.test(stripped)) {
    return { source: 'raw-html-rnm', verdict: 'no_sale', price: parsePrice(bidTo[1]), currency: 'USD', raw: { snippet: bidTo[0] } };
  }
  if (/reserve\s+not\s+met/i.test(stripped)) {
    return { source: 'raw-html-rnm', verdict: 'no_sale', price: null, currency: null, raw: {} };
  }
  if (/listing\s+(?:has\s+been\s+)?(?:withdrawn|cancelled)/i.test(stripped)) {
    return { source: 'raw-html-withdrawn', verdict: 'withdrawn', price: null, currency: null, raw: {} };
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const auctionId = searchParams.get('auction_id');
  if (!auctionId) return NextResponse.json({ error: 'auction_id required' }, { status: 400 });

  const supabase = getSupabaseClient();
  const { data: row, error: dbErr } = await supabase
    .from('auctions')
    .select('auction_id, title, url, current_bid, final_price, reserve_not_met, timestamp_end')
    .eq('auction_id', auctionId)
    .maybeSingle();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });

  const db = {
    auction_id: row.auction_id,
    title: row.title,
    url: row.url,
    current_bid: row.current_bid !== null ? Number(row.current_bid) : null,
    final_price: row.final_price !== null ? Number(row.final_price) : null,
    reserve_not_met: !!row.reserve_not_met,
    ended_at: row.timestamp_end ? new Date(row.timestamp_end * 1000).toISOString() : null,
  };

  if (!row.url) {
    return NextResponse.json({ db, bat: { verdict: 'inconclusive', error: 'No URL on row' }, discrepancy: 'No URL to scrape' });
  }

  let response;
  try {
    response = await fetch(row.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return NextResponse.json({ db, bat: { verdict: 'inconclusive', error: err.message, signals: [] } });
  }

  const httpStatus = response.status;
  if (!response.ok) {
    return NextResponse.json({ db, bat: { verdict: 'inconclusive', http_status: httpStatus, error: `HTTP ${httpStatus}`, signals: [] } });
  }

  const html = await response.text();
  const htmlLength = html.length;

  if (/Just a moment\.\.\.|cf-browser-verification|_cf_chl_opt\s*=/i.test(html)) {
    return NextResponse.json({ db, bat: { verdict: 'inconclusive', http_status: httpStatus, html_length: htmlLength, error: 'Cloudflare challenge', signals: [] } });
  }

  const signals = [];
  for (const fn of [fromNextData, fromMetaTag, fromRawHtml]) {
    const s = fn(html);
    if (s) signals.push(s);
  }

  // Pick the highest-confidence verdict: __NEXT_DATA__ > meta > raw, but only
  // if a "decisive" verdict is present. Multiple sources agreeing strengthens
  // the read; we surface them all so the human can judge edge cases.
  const decisive = signals.find((s) => s.verdict !== 'inconclusive') || signals[0];
  const verdict = decisive?.verdict || 'inconclusive';
  const price = decisive?.price ?? null;
  const currency = decisive?.currency ?? null;

  // Compute the discrepancy string. DB classifications:
  //   final_price > 0 → 'sold'
  //   final_price = 0 → 'withdrawn'
  //   final_price = null && reserve_not_met → 'no_sale'
  //   final_price = null && !reserve_not_met → 'pending/stuck'
  let dbVerdict;
  if (db.final_price === null) {
    dbVerdict = db.reserve_not_met ? 'no_sale' : 'pending';
  } else if (db.final_price === 0) {
    dbVerdict = 'withdrawn';
  } else {
    dbVerdict = 'sold';
  }

  let discrepancy = null;
  if (verdict !== 'inconclusive' && verdict !== dbVerdict) {
    const dbLabel = dbVerdict === 'sold' ? `sold $${db.final_price.toLocaleString()}` : dbVerdict;
    const batLabel = verdict === 'sold' && price ? `sold $${price.toLocaleString()}` : verdict;
    discrepancy = `DB says ${dbLabel}, BaT says ${batLabel}`;
  }

  return NextResponse.json({
    db,
    bat: {
      verdict,
      price,
      currency,
      signals,
      http_status: httpStatus,
      html_length: htmlLength,
    },
    discrepancy,
  });
}
