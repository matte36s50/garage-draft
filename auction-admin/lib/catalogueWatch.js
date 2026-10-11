/**
 * Catalogue watch: the pure parts, shared by the daily job
 * (scripts/catalogue-watch.mjs) and its ingest route
 * (app/api/store/catalogue/ingest).
 *
 * The job renders each house's upcoming catalogues in a headless browser and
 * has the Live Entry extractor read them, so estimates reach the store before
 * the sale (RM Sotheby's deletes them from sold lots afterwards). After the
 * sale it reads the same pages again for results. Lots are keyed by the
 * house's own lot page URL, which exists before lot numbers are assigned and
 * stays the same after the sale, so every pass updates the same row.
 *
 * Writes go in as entered_by 'scraper': a field a human has corrected in the
 * admin panel is never overwritten by a later pass.
 */

/**
 * One entry per house the watch reads.
 *   index        pages that list the house's upcoming sales
 *   follow       links on the index to sale pages that in turn link to the catalogue
 *   catalogue    which links on those pages are sale catalogues (tested with the
 *                query string only when catalogueUrl is given, which also
 *                trims it to the parts that identify the sale)
 *   eventName    the sale's name from its catalogue URL, where the page title
 *                doesn't carry it
 *   lotLink      a lot's own page; the capture groups form its stable key
 *   titlePrefix  house name some sites put before the sale name in <title>
 *   premium      true: results are published including buyer's premium, so
 *                the shown price is the all-in price. null: not confirmed;
 *                the price is stored as shown and flagged in raw_payload.
 *   estimatesOnly  only lots that show an estimate go to Claude (catalogues
 *                of thousands of lots where only the top few carry one)
 *   maxPages     catalogue pages read per pass
 *   enabled      false: read only when named on the command line
 */
export const HOUSES = {
  rm: {
    name: "RM Sotheby's",
    index: ['https://rmsothebys.com/upcoming/'],
    catalogue: /^https:\/\/rmsothebys\.com\/auctions\/[a-z0-9]+\/lots\/$/i,
    // r0037 cars; c0061, n2035 automobilia and memorabilia (the extractor skips those)
    lotLink: /\/auctions\/([a-z0-9]+)\/lots\/([a-z]\d{3,})(?=[-/]|$)/i,
    premium: true,
    maxPages: 10,
  },
  broadarrow: {
    name: 'Broad Arrow',
    index: ['https://bid.broadarrowauctions.com/'],
    catalogue: /^https:\/\/bid\.broadarrowauctions\.com\/auctions\/\d-[a-z0-9]+\/[a-z0-9-]+$/i,
    lotLink: /\/lots\/(?:view\/)?(\d-[a-z0-9]+)(?=[/?#]|$)/i,
    premium: true,
    maxPages: 10,
  },
  gooding: {
    name: "Gooding Christie's",
    // A sale's catalogue is the lots list filtered to its venue and year,
    // linked from goodingco.com and its sale pages.
    index: ['https://www.goodingco.com/'],
    follow: /^https:\/\/www\.goodingco\.com\/auction\/(?!realized\/)[a-z0-9-]+\/?$/i,
    catalogue: /^https:\/\/www\.goodingco\.com\/lots\/?\?.*liveAuctionVenue/i,
    catalogueUrl: (u) => {
      const url = new URL(u);
      const keep = new URLSearchParams();
      for (const k of ['filtersInput[auctionType][0]', 'filtersInput[auctionYear][0]', 'filtersInput[liveAuctionVenue][0]']) {
        if (url.searchParams.get(k)) keep.set(k, url.searchParams.get(k));
      }
      return `https://www.goodingco.com/lots/?${keep.toString()}`;
    },
    eventName: (u) => {
      const q = new URL(u).searchParams;
      return [q.get('filtersInput[liveAuctionVenue][0]'), q.get('filtersInput[auctionYear][0]')].filter(Boolean).join(' ');
    },
    lotLink: /\/lot\/([a-z0-9-]+)\/?$/i,
    premium: true,
    maxPages: 10,
  },
  // Off: Mecum's lot cards show no estimates (none on 2,900 lots across nine
  // sales, September 2026); where it publishes one, it is only in its search
  // feed. Reading 20 pages a sale for nothing took most of the run.
  mecum: {
    enabled: false,
    name: 'Mecum',
    index: ['https://www.mecum.com/auctions/'],
    catalogue: /^https:\/\/www\.mecum\.com\/auctions\/[a-z0-9-]+-\d{4}\/lots\/$/i,
    lotLink: /\/lots\/(\d+)(?=[/?#]|$)/i,
    titlePrefix: /^mecum\s+/i,
    premium: null,
    estimatesOnly: true,
    maxPages: 20,
  },
};

export const slug = (s) => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/**
 * The store key for a lot: `cw-<house>-<the house's own lot id>`. Falls back
 * to the lot number, then to year/make/model, when a page shows no link;
 * never to anything time-based, so a second pass finds the same row.
 */
export function watchListingId(houseId, lot, eventName) {
  const house = HOUSES[houseId];
  const url = lot.lot_url ? String(lot.lot_url) : '';
  if (url) {
    const m = house?.lotLink && url.match(house.lotLink);
    if (m) return `cw-${houseId}-${slug(m.slice(1).filter(Boolean).join('-'))}`;
    try {
      return `cw-${houseId}-${slug(new URL(url).pathname)}`;
    } catch { /* not a URL: fall through */ }
  }
  const ev = slug(eventName) || 'sale';
  if (lot.lot) return `cw-${houseId}-${ev}-lot-${slug(lot.lot)}`;
  return `cw-${houseId}-${ev}-${slug([lot.year, lot.make, lot.model, lot.trim].filter(Boolean).join(' '))}`;
}

/** "The London Auction 2026 | Available Lots | RM Sotheby's" -> "The London Auction 2026". */
export function eventNameFromTitle(title, houseId) {
  const house = HOUSES[houseId];
  const houseWords = slug(house?.name || '').split('-').filter((w) => w.length > 2);
  const parts = String(title || '').split(/\s+[|–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  const name = parts.find((p) => {
    const s = slug(p);
    return s && !houseWords.some((w) => s === w || s.startsWith(`${w}-auction`) || s === slug(house?.name));
  }) || parts[0] || '';
  return house?.titlePrefix ? name.replace(house.titlePrefix, '').trim() : name;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const ORD = String.raw`(?:st|nd|rd|th)?`;
const SEP = String.raw`\s*(?:-|–|—|&|to|and)\s*`;
// "14-15 August 2026", "31 October 2026", "30 October – 1 November 2026"
const DAY_FIRST = new RegExp(String.raw`\b(\d{1,2})${ORD}(?:\s+${MONTH})?(?:${SEP}(\d{1,2})${ORD})?\s+${MONTH},?\s+(\d{4})\b`, 'gi');
// "October 9, 2026", "November 19–22, 2026", "October 30 - November 1, 2026"
const MONTH_FIRST = new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})${ORD}(?:${SEP}(?:${MONTH}\s+)?(\d{1,2})${ORD})?,?\s+(\d{4})\b`, 'gi');

const monthIndex = (m) => MONTHS.indexOf(String(m).slice(0, 3).toLowerCase());

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(Number(y), m, Number(d)));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== Number(d)) return null;
  return dt.toISOString().slice(0, 10);
}

// A closing date for an online sale: "Bidding closes 14 October 2026",
// "lots begin to close at 17:00 CET on Wednesday, 14 October", "Ends Oct 14".
// The year may be left off; it is taken from the sale's first date.
const CLOSE_CUE = /\b(?:clos(?:e|es|ing)|bidding\s+ends?|ends?|ending)\b/gi;
const CLOSE_DAY_FIRST = new RegExp(String.raw`\b(\d{1,2})${ORD}\s+${MONTH}(?:,?\s+(\d{4}))?\b`, 'i');
const CLOSE_MONTH_FIRST = new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})${ORD}(?:,?\s+(\d{4}))?\b`, 'i');
const CLOSE_WINDOW = 90; // characters after the cue
const MAX_ONLINE_DAYS = 60;

function closingDate(text, start) {
  let latest = null;
  for (const cue of String(text || '').matchAll(CLOSE_CUE)) {
    const after = text.slice(cue.index + cue[0].length, cue.index + cue[0].length + CLOSE_WINDOW);
    const a = after.match(CLOSE_DAY_FIRST);
    const b = after.match(CLOSE_MONTH_FIRST);
    const pick = [a && { at: a.index, d: a[1], m: a[2], y: a[3] }, b && { at: b.index, d: b[2], m: b[1], y: b[3] }]
      .filter(Boolean).sort((x, y) => x.at - y.at)[0];
    if (!pick) continue;
    const startYear = Number(start.slice(0, 4));
    let day = isoDate(pick.y || startYear, monthIndex(pick.m), pick.d);
    if (day && !pick.y && day < start) day = isoDate(startYear + 1, monthIndex(pick.m), pick.d);
    if (!day || day < start || daysBetween(start, day) > MAX_ONLINE_DAYS) continue;
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

/**
 * The first sale date or date range a page states, as ISO days:
 * { starts_on, ends_on } or null. Only dates with a year count for the
 * start. An online sale often shows only its opening date up front, so a
 * stated closing date ("closes 14 October") later in the text, up to two
 * months on, becomes ends_on: reading results on the opening day would
 * record every lot still taking bids as unsold.
 */
export function parseSaleDates(text) {
  const found = [];
  for (const m of String(text || '').matchAll(DAY_FIRST)) {
    const [, d1, m1, d2, m2, y] = m;
    const endMonth = monthIndex(m2);
    const startMonth = m1 ? monthIndex(m1) : endMonth;
    const start = isoDate(y, startMonth, d1);
    const end = d2 ? isoDate(y, endMonth, d2) : isoDate(y, endMonth, d1);
    if (start && end && !(m1 && !d2)) found.push({ at: m.index, starts_on: start, ends_on: end >= start ? end : start });
  }
  for (const m of String(text || '').matchAll(MONTH_FIRST)) {
    const [, m1, d1, m2, d2, y] = m;
    const startMonth = monthIndex(m1);
    const endMonth = m2 ? monthIndex(m2) : startMonth;
    const start = isoDate(y, startMonth, d1);
    const end = d2 ? isoDate(y, endMonth, d2) : start;
    if (start && end) found.push({ at: m.index, starts_on: start, ends_on: end >= start ? end : start });
  }
  if (!found.length) return null;
  const first = found.sort((a, b) => a.at - b.at)[0];
  const closes = closingDate(text, first.starts_on);
  return { starts_on: first.starts_on, ends_on: closes && closes > first.ends_on ? closes : first.ends_on };
}

const DAY_MS = 86_400_000;
export const daysBetween = (fromISO, toISO) =>
  Math.round((Date.parse(String(toISO).slice(0, 10)) - Date.parse(String(fromISO).slice(0, 10))) / DAY_MS);

/**
 * Whether today's pass should send a sale's catalogue to Claude. Reading a
 * page is free; extraction is what costs, so an unchanged page is skipped and
 * a changed one is re-read at most weekly, then daily from 8 days before the
 * sale through its last day (late additions, revised estimates).
 */
export function shouldCapture(entry, { hash, today, sale }) {
  if (sale?.ends_on && today > sale.ends_on) return { capture: false, reason: 'sale over' };
  if (!entry?.capturedAt) return { capture: true, reason: 'first capture' };
  if (entry.hash === hash) return { capture: false, reason: 'unchanged' };
  if (sale?.starts_on && daysBetween(today, sale.starts_on) <= 8) {
    return { capture: true, reason: 'changed; sale within 8 days' };
  }
  const since = daysBetween(entry.capturedAt, today);
  if (since >= 7) return { capture: true, reason: 'changed; weekly refresh' };
  return { capture: false, reason: `changed; next refresh in ${7 - since} day(s)` };
}

/**
 * Whether a finished sale's page should be read for results: the first run
 * after its last day, then again whenever the page changes in the two weeks
 * after (late "sold after auction" updates). A read that found no results
 * posted yet (see resultsPosted) waits for the page to change, so a
 * "results coming soon" page costs one extraction, not one a day.
 */
export function resultsDue(entry, { hash, today, sale }) {
  if (!sale?.ends_on || today <= sale.ends_on) return { due: false, reason: 'not finished' };
  if (!entry?.resultsAt && entry?.resultsHeldHash === hash) {
    return { due: false, reason: 'waiting for results to be posted (page unchanged)' };
  }
  if (!entry?.resultsAt) return { due: true, reason: entry?.resultsHeldHash ? 'page changed since results were pending' : 'sale finished' };
  if (entry.resultsHash !== hash && daysBetween(sale.ends_on, today) <= 14) {
    return { due: true, reason: 'results page changed' };
  }
  return { due: false, reason: 'results captured' };
}

// A catalogue estimate as printed: "$1,200,000 - $1,500,000", "€4.000.000 - €5.000.000",
// "CHF 5'500'000 - CHF 7'500'000", "Est. £300,000 to £400,000".
const MONEY_RANGE = /(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)\s?\d[\d,.' ]*\d\s*(?:-|–|—|to)\s*(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)?\s?\d/i;
export const LOT_MARKER = '[lot: ';

/**
 * Keep only the lots whose text shows an estimate range. The page text marks
 * each lot with "[lot: URL]"; whatever precedes the first marker (the sale's
 * header, with its name and dates) is kept.
 */
export function estimatesOnly(text) {
  const parts = String(text).split(`\n${LOT_MARKER}`);
  const head = parts.shift();
  const kept = parts.filter((p) => MONEY_RANGE.test(p));
  return { text: [head, ...kept.map((p) => `${LOT_MARKER}${p}`)].join('\n'), kept: kept.length, dropped: parts.length - kept.length };
}

/**
 * Whether an extracted results page actually carries results. A sale where
 * no lot sold is, in practice, a page without results: bidding still open,
 * or "results coming soon". Writing it would mark every lot unsold, so the
 * caller holds it and reads again when the page changes.
 */
export function resultsPosted(lots) {
  return (lots || []).some((l) => l?.outcome === 'sold');
}

/**
 * The sale's dates for this run. The page is the authority whenever it states
 * them, so a closing date read wrongly before (an online sale's opening day)
 * is corrected; then what the watch recorded; then the store's date, which is
 * a start date only.
 */
export function chooseSaleDates({ page, recorded, store }) {
  if (page) return page;
  if (recorded?.starts_on) return { starts_on: recorded.starts_on, ends_on: recorded.ends_on || recorded.starts_on };
  if (store?.starts_on) return { starts_on: store.starts_on, ends_on: store.starts_on };
  return null;
}

const OUTCOMES = new Set(['sold', 'reserve_not_met', 'withdrawn']);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/**
 * Extracted lots -> auction_upsert_listings batch items. Amounts stay in the
 * lot's own currency (the MAI export converts at the sale-date rate).
 * Returns { items, skipped: [{ lot, reason }] }.
 */
export function buildIngestItems({ houseId, event, catalogueUrl, mode, lots, today }) {
  const house = HOUSES[houseId];
  if (!house) throw new Error(`Unknown house '${houseId}'`);
  if (!event?.name) throw new Error('event.name is required');

  // A lot whose currency the page didn't state takes the sale's usual one.
  const counts = {};
  for (const l of lots) if (l.currency) counts[String(l.currency).toUpperCase()] = (counts[String(l.currency).toUpperCase()] || 0) + 1;
  const saleCurrency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const lot of lots) {
    if (!lot.make || !lot.model) { skipped.push({ lot, reason: 'no make or model' }); continue; }
    const id = watchListingId(houseId, lot, event.name);
    if (seen.has(id)) { skipped.push({ lot, reason: 'duplicate' }); continue; }
    seen.add(id);

    const payload = {
      raw_title: [lot.year, lot.make, lot.model, lot.trim].filter(Boolean).join(' '),
      year: num(lot.year) != null ? Math.trunc(num(lot.year)) : undefined,
      make: lot.make,
      model: lot.model,
      trim: lot.trim || undefined,
      url: lot.lot_url || undefined,
      currency: (lot.currency || saleCurrency || '').toUpperCase() || undefined,
      event_name: event.name,
      event_house: house.name,
      event_location: event.location || undefined,
      estimate_low: num(lot.estimate_low),
      estimate_high: num(lot.estimate_high),
      // Provenance, kept in raw_payload.
      captured_by: 'catalogue-watch',
      house_id: houseId,
      catalogue_url: catalogueUrl,
      lot: lot.lot || undefined,
    };
    if (payload.estimate_low != null && payload.estimate_high != null && payload.estimate_high < payload.estimate_low) {
      [payload.estimate_low, payload.estimate_high] = [payload.estimate_high, payload.estimate_low];
    }

    if (mode === 'estimate') {
      payload.status = 'upcoming';
      if (event.starts_on) payload.ends_at = event.starts_on;
    } else {
      const outcome = OUTCOMES.has(lot.outcome) ? lot.outcome : null;
      if (!outcome) { skipped.push({ lot, reason: 'no result on the page' }); continue; }
      const price = num(lot.price);
      if (outcome === 'sold' && !(price > 0)) { skipped.push({ lot, reason: 'sold without a price' }); continue; }
      payload.status = 'ended';
      payload.outcome = outcome;
      payload.ended_at = event.ends_on || event.starts_on || today;
      if (outcome === 'sold') {
        if (house.premium === true) payload.price_all_in = price;
        else payload.price = price;
        if (house.premium !== true) payload.premium_basis = house.premium === false ? 'hammer' : 'unconfirmed';
      } else if (price > 0) {
        payload.current_bid = price; // a no-sale's high bid is never a price
      }
    }

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    items.push({ source_id: 'manual', source_listing_id: id, entered_by: 'scraper', payload });
  }
  return { items, skipped };
}
