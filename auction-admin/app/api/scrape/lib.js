import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Shared utilities for the auction scraping API.
 *
 * Authentication: requests must include either:
 *   - Header: Authorization: Bearer <CRON_SECRET>
 *   - Query param: ?secret=<CRON_SECRET>
 *
 * Uses the same CRON_SECRET env var as the existing cron jobs.
 */

export function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function verifyAuth(request) {
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, allow all requests (dev mode)
  if (!cronSecret) return null;

  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const secretParam = searchParams.get('secret');

  const isValidHeader = authHeader === `Bearer ${cronSecret}`;
  const isValidParam = secretParam === cronSecret;

  if (!isValidHeader && !isValidParam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null; // null = authorized
}

// User agents to rotate through when fetching auction pages
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
];

/**
 * Parse BaT listing page HTML to discover auctions.
 * Works with both the main listings page and search results.
 *
 * Returns an array of discovered auctions with:
 *   - url, title, imageUrl, currentBid, endTime, noReserve
 */
export function parseListingsHtml(html) {
  const auctions = [];

  // BaT listing items typically follow this structure in their listing cards.
  // We look for links to individual auction pages.
  const listingPattern = /<a[^>]+href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"[^>]*>/gi;
  const seen = new Set();
  let match;

  while ((match = listingPattern.exec(html)) !== null) {
    const url = match[1];
    // Deduplicate URLs
    if (seen.has(url)) continue;
    seen.add(url);

    // Try to extract title from the surrounding context (200 chars after the link)
    const contextAfter = html.slice(match.index, match.index + 2000);

    const title = extractTextContent(contextAfter, /<h[23][^>]*>(.*?)<\/h[23]>/is)
      || extractTextContent(contextAfter, /class="[^"]*listing-title[^"]*"[^>]*>(.*?)</is)
      || extractTitleFromUrl(url);

    const imageUrl = extractAttribute(contextAfter, /<img[^>]+src="([^"]+)"/i)
      || extractAttribute(contextAfter, /data-src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);

    const bidText = extractTextContent(contextAfter, /\$\s*([\d,]+)/);
    const currentBid = bidText ? parseInt(bidText.replace(/,/g, ''), 10) : null;

    const noReserve = /no\s+reserve/i.test(contextAfter.slice(0, 500));

    auctions.push({
      url: url.split('?')[0], // strip query params
      title: cleanHtml(title || ''),
      imageUrl: imageUrl || null,
      currentBid,
      noReserve,
    });
  }

  return auctions;
}

/**
 * Parse a single BaT auction page HTML to extract full details.
 *
 * Returns structured auction data:
 *   - title, make, model, year, currentBid, imageUrl, endTime,
 *     noReserve, location, seller, bodyStyle, engine, transmission,
 *     price (final), status, currency
 */
export function parseAuctionHtml(html, url = '') {
  const result = {
    url,
    title: null,
    make: null,
    model: null,
    year: null,
    currentBid: null,
    imageUrl: null,
    timestampEnd: null,
    noReserve: false,
    location: null,
    seller: null,
    bodyStyle: null,
    engine: null,
    transmission: null,
    mileage: null,
    finalPrice: null,
    status: 'active', // active, sold, no_sale, withdrawn
    currency: 'USD',
  };

  // --- Title ---
  result.title =
    extractTextContent(html, /<h1[^>]*class="[^"]*listing-title[^"]*"[^>]*>(.*?)<\/h1>/is)
    || extractTextContent(html, /<title>(.*?)(?:\s*[-–|].*)?<\/title>/is)
    || extractTextContent(html, /<h1[^>]*>(.*?)<\/h1>/is)
    || '';

  result.title = cleanHtml(result.title).trim();

  // --- Year / Make / Model from title ---
  const ymm = parseYearMakeModel(result.title);
  if (ymm) {
    result.year = ymm.year;
    result.make = ymm.make;
    result.model = ymm.model;
  }

  // --- Image ---
  result.imageUrl =
    extractAttribute(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i)
    || extractAttribute(html, /class="[^"]*gallery[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i)
    || extractAttribute(html, /<img[^>]+class="[^"]*featured[^"]*"[^>]+src="([^"]+)"/i);

  // --- Current bid ---
  const bidMatch =
    html.match(/Current\s+Bid[:\s]*(?:USD\s+)?\$\s*([\d,]+)/i)
    || html.match(/class="[^"]*bid-value[^"]*"[^>]*>\s*\$?\s*([\d,]+)/i)
    || html.match(/data-bid="(\d+)"/i);
  if (bidMatch) {
    result.currentBid = parseInt(bidMatch[1].replace(/,/g, ''), 10);
  }

  // --- End time ---
  // BaT includes epoch timestamps in data attributes and JS
  const epochMatch =
    html.match(/data-ends?="(\d{10,13})"/i)
    || html.match(/auction_end[_\s]*(?:time)?['":\s]+(\d{10,13})/i)
    || html.match(/ends?_at['":\s]+(\d{10,13})/i)
    || html.match(/countdown[^>]*data-(?:end|epoch|timestamp)="(\d{10,13})"/i);
  if (epochMatch) {
    let ts = parseInt(epochMatch[1], 10);
    // Convert ms to seconds if needed
    if (ts > 9999999999) ts = Math.floor(ts / 1000);
    result.timestampEnd = ts;
  }

  // --- No Reserve ---
  result.noReserve = /no\s+reserve/i.test(html);

  // --- Location ---
  result.location =
    extractTextContent(html, /(?:Location|Seller\s+Location)[:\s]*<[^>]*>([^<]+)</i)
    || extractTextContent(html, /class="[^"]*location[^"]*"[^>]*>([^<]+)/i);

  // --- Seller ---
  result.seller =
    extractTextContent(html, /(?:Seller|Offered\s+By)[:\s]*<[^>]*>([^<]+)</i)
    || extractTextContent(html, /class="[^"]*seller[^"]*"[^>]*>([^<]+)/i);

  // --- Vehicle details from essentials list ---
  result.bodyStyle = extractEssential(html, 'body style') || extractEssential(html, 'body');
  result.engine = extractEssential(html, 'engine');
  result.transmission = extractEssential(html, 'transmission') || extractEssential(html, 'drivetrain');
  const mileageStr = extractEssential(html, 'mileage') || extractEssential(html, 'miles');
  if (mileageStr) {
    const mileageNum = mileageStr.match(/([\d,]+)/);
    result.mileage = mileageNum ? mileageNum[1].replace(/,/g, '') : mileageStr;
  }

  // --- Final price / status (reuse existing logic) ---
  const priceInfo = extractFinalPrice(html);
  if (priceInfo.status === 'withdrawn') {
    result.status = 'withdrawn';
    result.finalPrice = null;
  } else if (priceInfo.status === 'sold' && priceInfo.price) {
    result.status = 'sold';
    result.finalPrice = priceInfo.price;
    result.currency = priceInfo.currency || 'USD';
  } else if (priceInfo.status === 'no_sale' && priceInfo.price) {
    result.status = 'no_sale';
    result.currentBid = priceInfo.price;
    result.currency = priceInfo.currency || 'USD';
  }

  return result;
}

/**
 * Extract final price from BaT HTML.
 * Mirrors the logic in finalize-auctions/route.js for consistency.
 */
export function extractFinalPrice(html) {
  // Withdrawn check
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

  // Sale patterns
  const salePatterns = [
    { pattern: /Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /Sold\s+for\s+EUR\s*€?\s*([\d,.]+)/i, currency: 'EUR' },
    { pattern: /Bid\s+to\s+EUR\s*€?\s*([\d,.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Bid\s+to\s+GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /Sold\s+for\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Bid\s+to\s+CAD\s*\$?\s*([\d,]+)/i, currency: 'CAD' },
    { pattern: /Sold\s+for\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Bid\s+to\s+AUD\s*\$?\s*([\d,]+)/i, currency: 'AUD' },
    { pattern: /Sold\s+for\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Bid\s+to\s+CHF\s*([\d,']+)/i, currency: 'CHF' },
    { pattern: /Sold\s+for\s+€\s*([\d,.]+)/i, currency: 'EUR' },
    { pattern: /Sold\s+for\s+£\s*([\d,]+)/i, currency: 'GBP' },
    { pattern: /<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*<\/strong>/i, currency: 'USD' },
  ];

  for (const { pattern, currency } of salePatterns) {
    const m = html.match(pattern);
    if (m) {
      let priceStr = m[1];
      if (currency === 'EUR' && priceStr.includes('.') && priceStr.includes(',')) {
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      } else if (currency === 'CHF') {
        priceStr = priceStr.replace(/'/g, '');
      }
      priceStr = priceStr.replace(/,/g, '');
      if (priceStr.includes('.')) priceStr = priceStr.split('.')[0];
      const price = parseInt(priceStr, 10);
      if (price > 0) return { price, status: 'sold', currency };
    }
  }

  // High bid / reserve not met
  const highBidPatterns = [
    { pattern: /High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)/i, currency: 'USD' },
    { pattern: /High\s+Bid\s+EUR\s*€?\s*([\d,.]+)/i, currency: 'EUR' },
    { pattern: /Reserve\s+Not\s+Met.*?\$\s*([\d,]+)/i, currency: 'USD' },
  ];
  for (const { pattern, currency } of highBidPatterns) {
    const m = html.match(pattern);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ''), 10);
      if (price > 0) return { price, status: 'no_sale', currency };
    }
  }

  return { price: null, status: null, currency: null };
}


// --- Internal helpers ---

function extractTextContent(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function extractAttribute(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function cleanHtml(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
}

function extractTitleFromUrl(url) {
  // https://bringatrailer.com/listing/1985-porsche-911-carrera-123/ → 1985 Porsche 911 Carrera
  const slug = url.split('/listing/')[1]?.replace(/\/$/, '') || '';
  return slug
    .replace(/-\d+$/, '') // remove trailing ID number
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseYearMakeModel(title) {
  // Matches patterns like "1985 Porsche 911 Carrera" or "No Reserve: 2015 BMW M3"
  const m = title.match(/(?:No\s+Reserve:\s*)?(\d{4})\s+(\S+)\s+(.*)/i);
  if (m) {
    return {
      year: parseInt(m[1], 10),
      make: m[2],
      model: m[3],
    };
  }
  return null;
}

function extractEssential(html, label) {
  // BaT essentials lists use patterns like:
  // <strong>Body Style</strong><span>Coupe</span>
  // or table rows with the label
  const patterns = [
    new RegExp(`<strong>\\s*${label}\\s*<\\/strong>\\s*<[^>]*>([^<]+)`, 'i'),
    new RegExp(`>${label}\\s*<\\/t[dh]>\\s*<t[dh][^>]*>([^<]+)`, 'i'),
    new RegExp(`${label}[:\\s]+([^<\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return cleanHtml(m[1]).trim();
  }
  return null;
}
