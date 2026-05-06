import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * POST /api/admin/backfill-makes
 *
 * Retroactively fills in make, model, and year for auctions where those fields
 * are NULL. Runs in two passes:
 *
 * Pass 1 (BaT URLs): fetches the BaT listing page and reads structured data
 *   from the embedded __NEXT_DATA__ JSON blob, which contains the canonical
 *   make/model/year that BaT stores.
 *
 * Pass 2 (title parsing fallback): for auctions without a BaT URL, or where
 *   the page fetch fails, attempts to extract year/make/model from the title
 *   string using a known-manufacturers list.
 *
 * Request body:
 *   { limit: 50, dry_run: false }
 *
 * Response:
 *   { updated, skipped, failed, dry_run, results }
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
];

// Comprehensive list of manufacturers seen on BaT, sorted longest-first so
// multi-word makes (e.g. "Alfa Romeo") are matched before shorter substrings.
const KNOWN_MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'Austin Healey',
  'De Tomaso', 'Land Rover', 'Rolls-Royce', 'Mercedes-Benz',
  'Bristol', 'Triumph', 'Packard', 'Studebaker', 'Lincoln',
  'Chrysler', 'Oldsmobile', 'Pontiac', 'Plymouth', 'Buick', 'Cadillac',
  'Datsun', 'Toyota', 'Honda', 'Mazda', 'Subaru', 'Nissan', 'Isuzu',
  'Mitsubishi', 'Lexus', 'Acura', 'Infiniti', 'Scion',
  'Ferrari', 'Lamborghini', 'Maserati', 'Fiat', 'Lancia', 'Alfa',
  'Porsche', 'BMW', 'Volkswagen', 'Audi', 'Alpina', 'Opel',
  'Mercedes', 'Maybach', 'Brabus', 'AMG',
  'Jaguar', 'Bentley', 'McLaren', 'Lotus', 'Morgan', 'TVR', 'Jensen',
  'Rover', 'MG', 'Mini', 'Triumph', 'Sunbeam', 'Austin',
  'Citroën', 'Citroen', 'Renault', 'Peugeot', 'Simca',
  'Saab', 'Volvo',
  'Ford', 'Chevrolet', 'Dodge', 'Jeep', 'GMC', 'Mercury',
  'Shelby', 'Carroll Shelby', 'Pantera', 'DeLorean', 'AMC', 'Eagle',
  'Corvette', 'Mustang',
  'Tesla', 'Rivian', 'Lucid',
  'RUF', 'Singer',
  'Willys', 'Kaiser', 'Hudson', 'Nash', 'DeSoto', 'Edsel',
].sort((a, b) => b.length - a.length);

/**
 * Try to extract make, model, year from a BaT listing page's __NEXT_DATA__ JSON.
 */
function extractFromNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
  if (!match) return null;

  let data;
  try { data = JSON.parse(match[1]); } catch { return null; }

  // BaT nests listing data at props.pageProps.listing
  const listing = data?.props?.pageProps?.listing;
  if (!listing) return null;

  // BaT field names vary slightly across listing types — try several paths
  const year = listing.year ?? listing.model_year ?? listing.vehicle_year ?? null;
  const make = listing.make ?? listing.manufacturer ?? listing.vehicle_make ?? null;
  const model =
    listing.model ??
    listing.model_name ??
    listing.vehicle_model ??
    // Some BaT listings expose just a combined "model_trim" or "specs.model"
    listing.specs?.model ??
    null;

  if (!make && !model && !year) return null;

  return {
    year: year ? parseInt(year, 10) : null,
    make: make ? String(make).trim() : null,
    model: model ? String(model).trim() : null,
    source: '__NEXT_DATA__',
  };
}

/**
 * Parse year, make, and model out of a BaT/auction title string.
 * BaT titles commonly follow: "YEAR MAKE MODEL description..."
 * e.g. "1985 Porsche 911 Carrera Coupe" → year=1985, make=Porsche, model=911 Carrera
 *
 * Falls back gracefully when the title doesn't match the expected pattern.
 */
function parseTitleFallback(title) {
  if (!title) return null;

  // 1. Find the first 4-digit year (1900–2029)
  const yearMatch = title.match(/\b(19\d\d|20[012]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // 2. Find the first known make in the portion of the title after the year
  const titleAfterYear = year
    ? title.slice(title.indexOf(String(year)) + 4).trim()
    : title;

  let make = null;
  let makeEndIdx = -1;
  for (const candidate of KNOWN_MAKES) {
    const regex = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = titleAfterYear.match(regex);
    if (m) {
      make = candidate; // use canonical casing
      makeEndIdx = m.index + m[0].length;
      break;
    }
  }

  if (!make) return year ? { year, make: null, model: null, source: 'title_year_only' } : null;

  // 3. Everything after the make is (roughly) the model — trim to ~3 words to
  //    avoid capturing excessive description text
  const afterMake = titleAfterYear.slice(makeEndIdx).trim();
  const modelWords = afterMake.split(/\s+/).slice(0, 4).join(' ');
  const model = modelWords || null;

  return { year, make, model: model || null, source: 'title_parse' };
}

async function fetchPage(url) {
  try {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { html: null, error: `HTTP ${res.status}` };
    const html = await res.text();

    // Cloudflare challenge
    if (
      /Just a moment\.\.\./i.test(html) ||
      /_cf_chl_opt\s*=/i.test(html) ||
      /challenge-platform\/h\/[bg]/i.test(html)
    ) {
      return { html: null, error: 'Cloudflare blocked' };
    }

    return { html, error: null };
  } catch (err) {
    return { html: null, error: err.name === 'TimeoutError' ? 'Timeout' : err.message?.slice(0, 80) };
  }
}

// POST: called from admin UI (already authenticated via middleware)
export async function POST(request) {
  const supabase = getSupabaseClient();

  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  const limit = Math.min(parseInt(body.limit ?? 50, 10), 200);
  const dryRun = body.dry_run === true;

  // Fetch auctions where make is null
  const { data: auctions, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, url, make, model, year')
    .is('make', null)
    .order('timestamp_end', { ascending: false })
    .limit(limit);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!auctions || auctions.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No auctions with null make found',
      updated: 0, skipped: 0, failed: 0, dry_run: dryRun, results: [],
    });
  }

  console.log(`[backfill-makes] Processing ${auctions.length} auctions (dry_run=${dryRun})`);

  const results = [];

  for (const auction of auctions) {
    const entry = {
      auction_id: auction.auction_id,
      title: auction.title,
      url: auction.url,
      found: null,
      source: null,
      updated: false,
      error: null,
    };

    // Pass 1: fetch BaT page and read __NEXT_DATA__
    if (auction.url?.includes('bringatrailer.com')) {
      const { html, error } = await fetchPage(auction.url);
      if (html) {
        const fromNextData = extractFromNextData(html);
        if (fromNextData && (fromNextData.make || fromNextData.year)) {
          entry.found = fromNextData;
          entry.source = '__NEXT_DATA__';
        }
      } else {
        entry.error = error;
      }
    }

    // Pass 2: title parsing fallback
    if (!entry.found) {
      const fromTitle = parseTitleFallback(auction.title);
      if (fromTitle && (fromTitle.make || fromTitle.year)) {
        entry.found = fromTitle;
        entry.source = fromTitle.source;
      }
    }

    if (!entry.found) {
      entry.error = entry.error || 'Could not determine make/model';
      results.push(entry);
      continue;
    }

    // Build the update — only set fields that we found and that are currently null
    const update = {};
    if (entry.found.make && !auction.make) update.make = entry.found.make;
    if (entry.found.model && !auction.model) update.model = entry.found.model;
    if (entry.found.year && !auction.year) update.year = entry.found.year;

    if (Object.keys(update).length === 0) {
      entry.error = 'Fields already populated';
      results.push(entry);
      continue;
    }

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('auctions')
        .update(update)
        .eq('auction_id', auction.auction_id);

      if (updateError) {
        entry.error = updateError.message;
        results.push(entry);
        continue;
      }
    }

    entry.updated = true;
    results.push(entry);
    console.log(`[backfill-makes] ${dryRun ? '[DRY] ' : ''}${auction.auction_id}: ${update.make || '—'} / ${update.model || '—'} / ${update.year || '—'} (${entry.source})`);
  }

  const updated = results.filter(r => r.updated).length;
  const failed = results.filter(r => !r.updated && r.error).length;
  const skipped = results.filter(r => !r.updated && !r.error).length;

  return NextResponse.json({
    success: true,
    dry_run: dryRun,
    total: auctions.length,
    updated,
    skipped,
    failed,
    results: results.slice(0, 100),
  });
}
