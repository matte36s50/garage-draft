/**
 * Lot and event matching for sale clean-up (the store panel's Sale Cleanup tab).
 *
 * The same live sale often reaches the canonical store twice: from the game
 * mirror (event named by auction_reference, `manual_…` lot ids, no estimates)
 * and through Live Entry (proper house, `<event>-lot-<n>` ids, often
 * estimates). Merging them, or attaching a catalogue's estimates to lots that
 * came from the game, means deciding which rows are the same car. That
 * decision is made here and always shown to a human before anything is
 * written.
 *
 * Pure, no I/O, so the preview in the browser and the server route agree.
 */

const MAKE_ALIASES = {
  mercedes: 'mercedes benz',
  benz: 'mercedes benz',
  mb: 'mercedes benz',
  vw: 'volkswagen',
  chevy: 'chevrolet',
  alfa: 'alfa romeo',
  rolls: 'rolls royce',
  aston: 'aston martin',
  'range rover': 'land rover',
  detomaso: 'de tomaso',
  'austin healey': 'austin healey',
};

const STOP_WORDS = new Set(['the', 'by', 'and', 'with', 'a', 'of', 'for', 'in']);

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "Mercedes-Benz" and "Mercedes" both -> "mercedes benz". */
export function normMake(make) {
  const s = stripAccents(make).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return MAKE_ALIASES[s] || s;
}

/**
 * Model (+ trim) as a set of tokens. Letter/digit runs are split, so "300SL"
 * and "300 SL" agree; the make and the model year are dropped because they
 * say nothing about which car this is within one sale.
 */
export function modelTokens(lot) {
  const text = stripAccents([lot?.model, lot?.trim].filter(Boolean).join(' ')).toLowerCase();
  const make = new Set(normMake(lot?.make).split(' ').filter(Boolean));
  const year = lot?.year != null ? String(lot.year) : null;
  const tokens = text.match(/[a-z]+|\d+/g) || [];
  return new Set(tokens.filter((t) => !STOP_WORDS.has(t) && !make.has(t) && t !== year));
}

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * A lot number, normalized the way Live Entry builds ids (slugged, leading
 * zeros dropped): from an explicit `lot`, else from a `<event>-lot-<n>` id.
 */
export function lotNumber(lot) {
  let raw = lot?.lot;
  if (raw == null || raw === '') {
    const m = String(lot?.source_listing_id ?? '').match(/-lot-([^/]+)$/);
    raw = m ? m[1] : null;
  }
  if (raw == null || raw === '') return null;
  const s = slug(raw).replace(/^lot-/, '');
  return /^\d+$/.test(s) ? String(Number(s)) : s || null;
}

function tokenSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const containment = shared / Math.min(a.size, b.size);
  const jaccard = shared / (a.size + b.size - shared);
  return 0.6 * containment + 0.4 * jaccard;
}

/**
 * How likely two lots are the same car, 0..1.
 *   - Lot numbers on both sides decide it outright.
 *   - Otherwise a known year or make that differs rules the pair out, and the
 *     model tokens carry the score. A missing year lowers it: without one,
 *     two 911s of different decades can look alike.
 */
export function scorePair(a, b) {
  const la = lotNumber(a);
  const lb = lotNumber(b);
  if (la && lb) return { score: la === lb ? 1 : 0, via: 'lot' };

  if (a?.year && b?.year && Number(a.year) !== Number(b.year)) return { score: 0, via: 'identity' };
  const ma = normMake(a?.make);
  const mb = normMake(b?.make);
  if (ma && mb && ma !== mb) return { score: 0, via: 'identity' };

  const sim = tokenSimilarity(modelTokens(a), modelTokens(b));
  const yearKnown = Boolean(a?.year && b?.year);
  return { score: yearKnown ? sim : sim * 0.85, via: 'identity' };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One-to-one matching of `incoming` lots onto `existing` lots.
 *
 * Greedy on score, highest first. A match is marked confidence 'check' when
 * it rests on identity rather than a lot number and either scored under 0.8
 * or had a rival within `margin` (two 1955 300 SL Gullwings in one sale) —
 * the panel leaves those unticked for a human to confirm.
 */
export function matchLots(existing, incoming, { threshold = 0.65, margin = 0.08 } = {}) {
  const cands = [];
  existing.forEach((e, i) => {
    incoming.forEach((n, j) => {
      const { score, via } = scorePair(e, n);
      if (score >= threshold) cands.push({ i, j, score, via });
    });
  });
  cands.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);

  const usedE = new Set();
  const usedN = new Set();
  const chosen = [];
  for (const c of cands) {
    if (usedE.has(c.i) || usedN.has(c.j)) continue;
    usedE.add(c.i);
    usedN.add(c.j);
    chosen.push(c);
  }

  const matches = chosen.map((m) => {
    const rival = cands.some((c) => c !== m && (c.i === m.i || c.j === m.j) && m.score - c.score <= margin);
    const confidence = m.via === 'lot' || (m.score >= 0.8 && !rival) ? 'high' : 'check';
    return { existing: existing[m.i], incoming: incoming[m.j], score: round2(m.score), via: m.via, confidence };
  });

  return {
    matches,
    unmatchedExisting: existing.filter((_, i) => !usedE.has(i)),
    unmatchedIncoming: incoming.filter((_, j) => !usedN.has(j)),
  };
}

// ------------------------------------------------------------ event duplicates

// Gooding & Company became Gooding Christie's; lots entered under either name
// belong to the same house.
const HOUSE_EQUIV = { christies: 'gooding' };
const GENERIC_NAME_WORDS = new Set([
  'auction', 'auctions', 'sale', 'sales', 'the', 'and', 'of', 'car', 'cars', 'collector', 'week',
]);
// Words that name a house rather than a sale. Game-style events carry the
// house inside the name ("Broad Arrow Porsche Air|Water 2026"), so these are
// stripped from every name, not only when the house field is filled in.
const HOUSE_WORDS = new Set([
  'rm', 'sothebys', 'sotheby', 'broad', 'arrow', 'gooding', 'christies', 'christie', 'company',
  'bonhams', 'mecum', 'barrett', 'jackson', 'artcurial', 'dorotheum',
]);

const words = (s) => (stripAccents(s).toLowerCase().match(/[a-z]+|\d+/g) || []);

/** First word of the house, or of the name when the house is just the name (game events). */
export function houseKey(ev) {
  const house = String(ev?.house ?? '').trim();
  const name = String(ev?.name ?? '').trim();
  const source = house && house.toLowerCase() !== name.toLowerCase() ? house : name;
  const first = words(source)[0] || '';
  return HOUSE_EQUIV[first] || first;
}

function nameTokens(ev) {
  const house = String(ev?.house ?? '').trim();
  const ownHouse = house && house.toLowerCase() !== String(ev?.name ?? '').trim().toLowerCase()
    ? words(house) : [];
  const houseWords = new Set([...ownHouse, houseKey(ev)]);
  return new Set(words(ev?.name).filter((w) => !GENERIC_NAME_WORDS.has(w) && !HOUSE_WORDS.has(w)
    && !houseWords.has(w) && !/^\d+$/.test(w) && w.length > 2));
}

const sharesToken = (a, b) => {
  for (const t of a) {
    for (const u of b) {
      if (t === u) return true;
      // "Arizon" / "Arizona": a typo still shares a long prefix.
      const n = Math.min(t.length, u.length);
      if (n >= 5 && t.slice(0, n) === u.slice(0, n)) return true;
    }
  }
  return false;
};

const dayMs = 24 * 3600 * 1000;

/**
 * Pairs of events that look like the same sale entered twice: same house,
 * a shared distinctive name word, and first lot dates within `days` of each
 * other (entry-date defaults can push one copy months late). Suggestions
 * only — the merge preview shows the lots before anything happens.
 */
export function suggestDuplicateEvents(events, { days = 120 } = {}) {
  const out = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i];
      const b = events[j];
      if (!houseKey(a) || houseKey(a) !== houseKey(b)) continue;
      if (!sharesToken(nameTokens(a), nameTokens(b))) continue;
      const da = a.first_date ? Date.parse(a.first_date) : NaN;
      const db = b.first_date ? Date.parse(b.first_date) : NaN;
      if (Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) > days * dayMs) continue;
      out.push(preferredDirection(a, b));
    }
  }
  return out;
}

/**
 * Which way to merge: keep the event with more estimates (Live Entry), then a
 * real house over a game-style name, then the one with more lots.
 */
export function preferredDirection(a, b) {
  const rank = (e) => [
    Number(e.with_estimate || 0),
    String(e.house || '').toLowerCase() !== String(e.name || '').toLowerCase() ? 1 : 0,
    Number(e.lots || 0),
  ];
  const ra = rank(a);
  const rb = rank(b);
  for (let k = 0; k < ra.length; k += 1) {
    if (ra[k] !== rb[k]) return ra[k] > rb[k] ? { into: a, from: b } : { into: b, from: a };
  }
  return { into: a, from: b };
}
