/**
 * Dual-write shim: mirror auction writes into the canonical auction store.
 *
 * Phase 2 of the auction-data consolidation plan (cc-market-survey:
 * auction-data-consolidation-plan.md). Server routes that write to this
 * app's `auctions` table also push the same facts through the canonical
 * store's one door — rpc public.auction_upsert_listings — so the stores can
 * be diffed before cutover.
 *
 * Entirely env-gated and failure-isolated:
 *   - CANONICAL_SUPABASE_URL + CANONICAL_SUPABASE_SERVICE_ROLE_KEY unset
 *     => every call is a cheap no-op ({ skipped: true }).
 *     (If the canonical schema lives in this same Supabase project, set them
 *     to this project's URL and service key.)
 *   - Any error is caught and returned, never thrown — mirroring must not
 *     break the primary write path.
 *
 * Keying matches the backfill loader: BaT listings by URL slug, manual
 * auctions by their manual_ id under source 'manual'.
 */

export function canonicalConfigured() {
  return Boolean(
    process.env.CANONICAL_SUPABASE_URL &&
    process.env.CANONICAL_SUPABASE_SERVICE_ROLE_KEY
  );
}

/** https://bringatrailer.com/listing/1990-bmw-m3-77/ -> 1990-bmw-m3-77 */
export function batSlug(url) {
  if (!url) return null;
  const m = String(url).match(/\/listing\/([^/?#]+)/);
  return m ? m[1].replace(/\/+$/, '') : null;
}

/**
 * Build a batch item from a garage-draft auctions row (or partial row).
 * Returns null when the row can't be keyed.
 */
export function toCanonicalItem(auction, { enteredBy } = {}) {
  if (!auction) return null;
  const auctionId = auction.auction_id || null;
  const url = auction.url || null;
  const isManual = Boolean(auctionId && String(auctionId).startsWith('manual_'));
  const isBat = Boolean(url && url.includes('bringatrailer.com')) && !isManual;

  const sourceId = isBat ? 'bat' : 'manual';
  const listingId = isBat ? (batSlug(url) || auctionId) : (auctionId || url);
  if (!listingId) return null;

  const tsEnd = auction.timestamp_end != null ? Number(auction.timestamp_end) : null;
  const endsAt = tsEnd ? new Date(tsEnd * 1000).toISOString() : null;
  const nowSec = Math.floor(Date.now() / 1000);

  let outcome = null;
  let price = null;
  let needsReview;
  if (auction.final_price != null) {
    if (Number(auction.final_price) === 0) {
      outcome = 'withdrawn'; // legacy encoding
      needsReview = true;
    } else {
      outcome = 'sold';
      price = Number(auction.final_price);
    }
  } else if (auction.reserve_not_met) {
    outcome = 'reserve_not_met';
  }
  const ended = outcome !== null || (tsEnd !== null && tsEnd < nowSec);

  const payload = {
    url: url || undefined,
    raw_title: auction.title || undefined,
    make: auction.make || undefined,
    model: auction.model || undefined,
    year: auction.year != null ? Number(auction.year) : undefined,
    image_url: auction.image_url || undefined,
    current_bid: auction.current_bid != null ? Number(auction.current_bid) : undefined,
    status: ended ? 'ended' : 'live',
    outcome: outcome || undefined,
    price: price != null ? price : undefined,
    currency: auction.currency || undefined,
    ends_at: endsAt || undefined,
    ended_at: ended ? (endsAt || undefined) : undefined,
    event_name: auction.auction_reference || undefined,
    needs_review: needsReview,
    raw: auction,
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  return {
    source_id: sourceId,
    source_listing_id: String(listingId),
    entered_by: enteredBy || (isManual ? 'manual' : 'scraper'),
    payload,
  };
}

/**
 * Push batch items (from toCanonicalItem) to the canonical store.
 * Never throws. Returns { skipped } | { ok, mirrored } | { ok: false, error }.
 */
export async function canonicalUpsertListings(items) {
  try {
    if (!canonicalConfigured()) return { skipped: true };
    const batch = (items || []).filter(Boolean);
    if (batch.length === 0) return { skipped: true };

    const url = process.env.CANONICAL_SUPABASE_URL.replace(/\/+$/, '');
    const key = process.env.CANONICAL_SUPABASE_SERVICE_ROLE_KEY;
    const resp = await fetch(`${url}/rest/v1/rpc/auction_upsert_listings`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_batch: batch }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      console.error(`[canonical] HTTP ${resp.status}: ${detail}`);
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    console.log(`[canonical] mirrored ${batch.length} listing(s) to canonical store`);
    return { ok: true, mirrored: batch.length };
  } catch (error) {
    console.error(`[canonical] dual-write failed (non-fatal): ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/* ------------------------------------------------------------------------ *
 * Read/RPC helpers for the unified admin panel (/store). Server-side only —
 * these use the service key and must never be imported by client components.
 * Unlike the mirror above, callers here WANT errors surfaced, so failures
 * return { ok: false, status, error } for the route to translate.
 * ------------------------------------------------------------------------ */

function canonicalBase() {
  return {
    url: process.env.CANONICAL_SUPABASE_URL?.replace(/\/+$/, ''),
    key: process.env.CANONICAL_SUPABASE_SERVICE_ROLE_KEY,
  };
}

/** GET a PostgREST path (e.g. 'auction_listings_all?status=eq.live&limit=50'). */
export async function canonicalGet(pathAndQuery, { count = false } = {}) {
  if (!canonicalConfigured()) {
    return { ok: false, status: 503, error: 'Canonical store not configured (set CANONICAL_SUPABASE_URL and CANONICAL_SUPABASE_SERVICE_ROLE_KEY)' };
  }
  const { url, key } = canonicalBase();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (count) headers.Prefer = 'count=exact';
  try {
    const resp = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      headers, signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: (await resp.text()).slice(0, 300) };
    }
    const rows = await resp.json();
    const range = resp.headers.get('content-range'); // "0-49/1234"
    const total = range?.includes('/') ? Number(range.split('/')[1]) : undefined;
    return { ok: true, rows, total: Number.isFinite(total) ? total : undefined };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}

/** Call a public.auction_* RPC with named args. */
export async function canonicalRpc(fn, args) {
  if (!canonicalConfigured()) {
    return { ok: false, status: 503, error: 'Canonical store not configured (set CANONICAL_SUPABASE_URL and CANONICAL_SUPABASE_SERVICE_ROLE_KEY)' };
  }
  const { url, key } = canonicalBase();
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, status: resp.status, error: text.slice(0, 300) };
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}
