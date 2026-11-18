/**
 * Results for catalogue (live-auction) lots, read straight from the house's
 * own lot page, with no Claude call. Gooding Christie's only, for now.
 *
 * Why this exists: the catalogue watch reads results through Claude, and when
 * its API credit runs out no results reach the game at all. A Gooding lot page
 * shows the result in plain markup:
 *
 *   <div class="vehicleDetails-module--modal…"><h2>2026 | </h2><a>Retromobile New York Auctions</a></div>
 *   <div class="vehicleDetails-module--specification…"><h2>SOLD  $3,085,000</h2></div>
 *
 * Two traps, both handled here:
 *   - Gooding reuses a lot URL when the same model comes up again, so a page
 *     can show an older sale's result. A result counts only when the page
 *     names the sale the game lot belongs to (saleMatches).
 *   - The published price includes the buyer's premium. Catalogue lots are
 *     priced at their low estimate, which is a hammer price, so the result is
 *     worked back to the hammer price before it is compared (hammerFromAllIn).
 *
 * Pure: no I/O. The hourly finalizer (app/api/cron/finalize-auctions) fetches
 * the pages and writes what this returns.
 */

// Gooding Christie's vehicle lots (cars and motorcycles), from the Rétromobile
// New York 2026 sale page: 12% of the final bid up to $250,000, and 10% of the
// part above it. Automobilia lots pay 25%; none are in a game pool.
export const GOODING_VEHICLE_FEES = [
  { up_to: 250000, pct: 12 },
  { up_to: null, pct: 10 },
];

/** The all-in price for a hammer price under marginal tiers. */
export function allInFromHammer(hammer, tiers = GOODING_VEHICLE_FEES) {
  let premium = 0;
  let from = 0;
  for (const { up_to, pct } of tiers) {
    const top = up_to == null ? hammer : Math.min(hammer, up_to);
    if (top > from) premium += (top - from) * (pct / 100);
    if (up_to == null || hammer <= up_to) break;
    from = up_to;
  }
  return hammer + premium;
}

/**
 * The hammer price behind a published all-in price, under marginal tiers.
 * Rounded to the dollar; null for anything that isn't a positive number.
 */
export function hammerFromAllIn(allIn, tiers = GOODING_VEHICLE_FEES) {
  const price = Number(allIn);
  if (!Number.isFinite(price) || price <= 0) return null;
  let from = 0;
  for (const { up_to, pct } of tiers) {
    const atTop = up_to == null ? Infinity : allInFromHammer(up_to, tiers);
    if (price <= atTop) {
      return Math.round(from + (price - allInFromHammer(from, tiers)) / (1 + pct / 100));
    }
    from = up_to;
  }
  return null;
}

const STOP = new Set(['gooding', 'christie', 'christies', 's', 'co', 'company', 'and', 'the', 'auction', 'auctions']);
const words = (text) => String(text || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * Whether a lot page's sale label ("2026 | Retromobile New York Auctions")
 * names the sale a game lot belongs to (auctions.auction_reference, such as
 * "Gooding Retromobile New York 2026"). Every word of the reference but the
 * house's name must appear in the label, and so must its year.
 */
export function saleMatches(saleLabel, reference) {
  const label = new Set(words(saleLabel));
  const wanted = words(reference).filter((w) => !STOP.has(w));
  if (label.size === 0 || wanted.length === 0) return false;
  return wanted.every((w) => label.has(w));
}

const text = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Read a Gooding lot page.
 *   { saleLabel, soldAllIn, notSold }
 * soldAllIn: the published price (premium included) when the page says SOLD.
 * notSold:   true when the page says the lot did not sell.
 */
export function parseGoodingLot(html) {
  const page = String(html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ');
  const label = page.match(/vehicleDetails-module--modal[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const saleLabel = label ? text(label[1]) : null;
  const specs = [...page.matchAll(/vehicleDetails-module--specification--[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
  let soldAllIn = null;
  let notSold = false;
  for (const spec of specs) {
    const sold = spec.match(/^SOLD\s+\$\s?([\d,]+)/i);
    if (sold) { soldAllIn = Number(sold[1].replace(/,/g, '')); break; }
    if (/^(NOT SOLD|UNSOLD|BID TO|HIGH BID|NO SALE)\b/i.test(spec)) notSold = true;
  }
  return { saleLabel, soldAllIn: soldAllIn > 0 ? soldAllIn : null, notSold: soldAllIn ? false : notSold };
}

/**
 * What a fetched Gooding page means for one game lot:
 *   { outcome: 'sold', hammer, allIn } | { outcome: 'not_sold' } | { outcome: null, reason }
 */
export function goodingResult(html, reference) {
  const { saleLabel, soldAllIn, notSold } = parseGoodingLot(html);
  if (!saleLabel) return { outcome: null, reason: 'no sale label on the page' };
  if (!saleMatches(saleLabel, reference)) return { outcome: null, reason: `page shows another sale (${saleLabel})` };
  if (soldAllIn) return { outcome: 'sold', hammer: hammerFromAllIn(soldAllIn), allIn: soldAllIn };
  if (notSold) return { outcome: 'not_sold' };
  return { outcome: null, reason: 'no result on the page yet' };
}
