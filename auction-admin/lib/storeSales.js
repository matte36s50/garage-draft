import { canonicalGet } from './canonicalStore';

/**
 * Server-side reads for the Sale Cleanup tab. Uses the service key
 * through canonicalGet, so never import this from a client component.
 */

const PAGE = 1000; // PostgREST's default max-rows on Supabase

/** Page through a PostgREST query until a short page. */
export async function canonicalGetAll(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await canonicalGet(`${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`);
    if (!res.ok) return res;
    rows.push(...res.rows);
    if (res.rows.length < PAGE) return { ok: true, rows };
  }
}

export const LOT_FIELDS = [
  'id', 'source_id', 'source_listing_id', 'event_id', 'year', 'make', 'model', 'trim',
  'raw_title', 'status', 'outcome', 'price', 'price_all_in', 'currency',
  'estimate_low', 'estimate_high', 'ended_at', 'ends_at', 'needs_review',
].join(',');

/** Every lot of one event. */
export function fetchEventLots(eventId) {
  return canonicalGetAll(
    `auction_listings_all?select=${LOT_FIELDS}&event_id=eq.${encodeURIComponent(eventId)}&order=source_listing_id.asc`
  );
}

export async function fetchEvent(eventId) {
  const res = await canonicalGet(
    `auction_events_all?select=*&id=eq.${encodeURIComponent(eventId)}&limit=1`
  );
  if (!res.ok) return res;
  return res.rows.length ? { ok: true, event: res.rows[0] } : { ok: false, status: 404, error: 'Event not found' };
}

/**
 * Events with the counts the clean-up needs: how many lots, how many ended,
 * sold and carrying an estimate, how many are apex (low estimate >= $500K),
 * how many came from the game mirror, and the first lot date.
 */
export async function listEventsWithStats() {
  const ev = await canonicalGetAll('auction_events_all?select=*&order=created_at.desc');
  if (!ev.ok) return ev;
  const lots = await canonicalGetAll(
    'auction_listings_all?select=event_id,source_listing_id,status,outcome,estimate_low,ended_at,ends_at'
    + '&event_id=not.is.null&order=id.asc'
  );
  if (!lots.ok) return lots;

  const stats = new Map();
  for (const l of lots.rows) {
    const s = stats.get(l.event_id) || {
      lots: 0, ended: 0, sold: 0, with_estimate: 0, apex: 0, from_game: 0, first_date: null,
    };
    s.lots += 1;
    if (l.status === 'ended') s.ended += 1;
    if (l.outcome === 'sold') s.sold += 1;
    if (l.estimate_low != null) s.with_estimate += 1;
    if (Number(l.estimate_low) >= 500000) s.apex += 1;
    if (String(l.source_listing_id || '').startsWith('manual_')) s.from_game += 1;
    const d = String(l.ended_at || l.ends_at || '').slice(0, 10);
    if (d && (!s.first_date || d < s.first_date)) s.first_date = d;
    stats.set(l.event_id, s);
  }

  const empty = { lots: 0, ended: 0, sold: 0, with_estimate: 0, apex: 0, from_game: 0, first_date: null };
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  const rows = ev.rows.map((e) => {
    const s = stats.get(e.id) || empty;
    const starts = day(e.starts_on);
    return { ...e, ...s, starts_on: starts, ends_on: day(e.ends_on), sale_date: starts || s.first_date };
  });
  rows.sort((a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')));
  return { ok: true, rows };
}

/** PostgREST wraps a Postgres `raise exception` as JSON; surface its message. */
export function rpcErrorMessage(res) {
  try {
    const parsed = JSON.parse(res.error);
    if (parsed?.message) return parsed.message;
  } catch {
    // not JSON — fall through
  }
  return res.error || 'Store request failed';
}

/** Compact lot summary for previews (no raw payloads to the browser). */
export function lotSummary(l) {
  return {
    id: l.id,
    lot: (String(l.source_listing_id || '').match(/-lot-([^/]+)$/) || [])[1] || null,
    source_listing_id: l.source_listing_id,
    title: l.raw_title || [l.year, l.make, l.model, l.trim].filter(Boolean).join(' '),
    year: l.year, make: l.make, model: l.model, trim: l.trim,
    status: l.status, outcome: l.outcome,
    price: l.price_all_in ?? l.price, currency: l.currency,
    estimate_low: l.estimate_low, estimate_high: l.estimate_high,
  };
}
