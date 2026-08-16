/**
 * Buyer-premium fee schedules — flat rates and sliding scales.
 *
 * Auction houses publish a fee table rather than a single percentage. RM
 * Sotheby's Monterey, for example:
 *
 *   Cars:        12% on a hammer price up to $250,000
 *                10% on any balance over $250,000
 *   Motorcycles: 20% on the total hammer price
 *   Automobilia: 20% on the total hammer price
 *
 * A schedule here is a map of lot category -> { mode, tiers }:
 *
 *   {
 *     categories: {
 *       cars:        { mode: 'marginal', tiers: [{ up_to: 250000, pct: 12 },
 *                                                { up_to: null,   pct: 10 }] },
 *       motorcycles: { mode: 'marginal', tiers: [{ up_to: null,   pct: 20 }] },
 *     }
 *   }
 *
 * Two ways a table can slide:
 *   - 'marginal'  each band's rate applies only to the slice of the hammer
 *                 price inside that band (RM, Gooding, Bonhams — the norm).
 *   - 'bracket'   the whole hammer price takes the rate of the band it lands
 *                 in ("10% on lots over $250,000", no blending).
 * A single open-ended tier means the same thing in both modes: a flat rate.
 *
 * Tiers are stored ascending, each with the threshold it runs *up to*; the
 * last tier is open-ended (up_to: null). Amounts are in the event's catalog
 * currency, so premiums are computed before the FX conversion to USD.
 *
 * This module is pure (no I/O) and imported by both the server routes and the
 * admin panel, so the preview in the UI and the number written to the store
 * come from the same arithmetic.
 */

export const FEE_MODES = ['marginal', 'bracket'];

export const DEFAULT_CATEGORY = 'default';

/** Categories the UI offers; any other key is accepted but shown as-is. */
export const FEE_CATEGORY_LABELS = {
  default: 'All lots',
  cars: 'Cars',
  motorcycles: 'Motorcycles',
  automobilia: 'Automobilia',
};

const MAX_TIERS = 12;

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function categoryLabel(key) {
  return FEE_CATEGORY_LABELS[key] || key;
}

/** 'Motorcycles ' -> 'motorcycles'; anything unusable -> DEFAULT_CATEGORY. */
export function normalizeCategory(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key || DEFAULT_CATEGORY;
}

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize one category's tiers. Accepts a bare number (flat rate), an array
 * of tiers, or { mode, tiers }. Returns { mode, tiers } or null when empty.
 * Throws Error with a human-readable message on anything malformed — callers
 * surface it straight to the admin.
 */
export function normalizeTierSet(input, { label = 'fee schedule' } = {}) {
  if (input == null || input === '') return null;

  let mode = 'marginal';
  let rawTiers = input;
  if (!Array.isArray(input) && typeof input === 'object') {
    if (input.mode != null && input.mode !== '') {
      if (!FEE_MODES.includes(input.mode)) throw new Error(`${label}: unknown mode '${input.mode}'`);
      mode = input.mode;
    }
    rawTiers = input.tiers;
  }
  if (typeof rawTiers === 'number' || typeof rawTiers === 'string') {
    const pct = numOrNull(rawTiers);
    if (pct == null) throw new Error(`${label}: '${rawTiers}' is not a percentage`);
    rawTiers = [{ up_to: null, pct }];
  }
  if (rawTiers == null) return null;
  if (!Array.isArray(rawTiers)) throw new Error(`${label}: tiers must be a list`);

  const tiers = [];
  for (const t of rawTiers) {
    const pct = numOrNull(typeof t === 'object' && t !== null ? (t.pct ?? t.percent ?? t.rate) : t);
    const upTo = typeof t === 'object' && t !== null ? numOrNull(t.up_to ?? t.upTo ?? t.threshold) : null;
    if (pct == null) continue; // half-filled UI row — drop it rather than fail
    if (pct < 0 || pct > 100) throw new Error(`${label}: ${pct}% is not a valid buyer premium`);
    if (upTo != null && upTo <= 0) throw new Error(`${label}: tier threshold must be above 0`);
    tiers.push({ up_to: upTo, pct: round(pct, 4) });
  }
  if (tiers.length === 0) return null;
  if (tiers.length > MAX_TIERS) throw new Error(`${label}: at most ${MAX_TIERS} tiers`);

  // Ascending by threshold, open-ended tier last. Only one tier may be
  // open-ended — two would leave the top of the scale ambiguous.
  const open = tiers.filter((t) => t.up_to == null);
  if (open.length > 1) throw new Error(`${label}: only the top tier can be open-ended`);
  const bounded = tiers.filter((t) => t.up_to != null).sort((a, b) => a.up_to - b.up_to);
  for (let i = 1; i < bounded.length; i += 1) {
    if (bounded[i].up_to === bounded[i - 1].up_to) {
      throw new Error(`${label}: two tiers both end at ${bounded[i].up_to}`);
    }
  }
  const ordered = open.length ? [...bounded, open[0]] : bounded;
  // A schedule whose last tier is bounded leaves hammer prices above it
  // uncovered; carry the top rate onward rather than silently charging 0.
  if (ordered[ordered.length - 1].up_to != null) {
    ordered.push({ up_to: null, pct: ordered[ordered.length - 1].pct });
  }
  return { mode, tiers: ordered };
}

/**
 * Normalize a whole schedule. Accepts:
 *   12 | '12'                      -> flat 12% for all lots (legacy field)
 *   [{up_to, pct}, ...]            -> one sliding scale for all lots
 *   { mode, tiers }                -> same, with an explicit mode
 *   { categories: { cars: ... } }  -> per-category scales
 * Returns { categories: {...} } or null when nothing is configured.
 */
export function normalizeFeeSchedule(input) {
  if (input == null || input === '') return null;

  let categoriesInput;
  if (!Array.isArray(input) && typeof input === 'object' && input.categories) {
    categoriesInput = input.categories;
  } else {
    const set = normalizeTierSet(input);
    return set ? { categories: { [DEFAULT_CATEGORY]: set } } : null;
  }

  const categories = {};
  for (const [rawKey, value] of Object.entries(categoriesInput)) {
    const key = normalizeCategory(rawKey);
    const set = normalizeTierSet(value, { label: `${categoryLabel(key)} fees` });
    if (set) categories[key] = set;
  }
  return Object.keys(categories).length ? { categories } : null;
}

/** The tier set a lot of `category` pays, falling back to the default one. */
export function tierSetForCategory(schedule, category) {
  if (!schedule || !schedule.categories) return null;
  const key = normalizeCategory(category);
  const cats = schedule.categories;
  if (cats[key]) return cats[key];
  if (cats[DEFAULT_CATEGORY]) return cats[DEFAULT_CATEGORY];
  // A schedule with exactly one category and no default (e.g. an event that
  // only sells cars) applies that one to everything.
  const keys = Object.keys(cats);
  return keys.length === 1 ? cats[keys[0]] : null;
}

/**
 * Buyer premium for a hammer price under one tier set.
 * Returns null when there is nothing to apply, otherwise:
 *   { premium, price_all_in, effective_pct, mode, breakdown: [{from,to,pct,amount}] }
 */
export function computePremiumForTiers(hammer, tierSet) {
  const price = numOrNull(hammer);
  if (!tierSet || price == null || price <= 0) return null;

  const { mode, tiers } = tierSet;
  const breakdown = [];
  let premium = 0;

  if (mode === 'bracket') {
    const tier = tiers.find((t) => t.up_to == null || price <= t.up_to) || tiers[tiers.length - 1];
    premium = price * (tier.pct / 100);
    breakdown.push({ from: 0, to: tier.up_to, pct: tier.pct, amount: round(premium, 2) });
  } else {
    let floor = 0;
    for (const tier of tiers) {
      const ceiling = tier.up_to == null ? Infinity : tier.up_to;
      const slice = Math.min(price, ceiling) - floor;
      if (slice > 0) {
        const amount = slice * (tier.pct / 100);
        premium += amount;
        breakdown.push({ from: floor, to: tier.up_to, pct: tier.pct, amount: round(amount, 2) });
      }
      floor = ceiling;
      if (price <= ceiling) break;
    }
  }

  premium = round(premium, 2);
  return {
    mode,
    premium,
    price_all_in: round(price + premium, 2),
    // The blended rate this lot actually paid — what a flat buyer_premium_pct
    // would have to be to produce the same all-in price.
    effective_pct: round((premium / price) * 100, 4),
    breakdown,
  };
}

/** computePremiumForTiers, resolving the category against a whole schedule. */
export function computePremium(hammer, schedule, category) {
  const tierSet = tierSetForCategory(schedule, category);
  if (!tierSet) return null;
  const result = computePremiumForTiers(hammer, tierSet);
  return result ? { ...result, category: normalizeCategory(category) } : null;
}

const fmtThreshold = (n) => {
  if (n == null) return '';
  if (n >= 1_000_000 && n % 100_000 === 0) return `$${round(n / 1_000_000, 2)}M`;
  if (n >= 1000 && n % 1000 === 0) return `$${n / 1000}k`;
  return `$${Number(n).toLocaleString()}`;
};

/** One-line summary of a tier set: '12% to $250k, then 10%'. */
export function describeTierSet(tierSet) {
  if (!tierSet || !tierSet.tiers.length) return '—';
  const { mode, tiers } = tierSet;
  if (tiers.length === 1) return `${tiers[0].pct}% flat`;
  const parts = tiers.map((t) => (
    t.up_to == null
      ? (mode === 'bracket' ? `${t.pct}% above` : `then ${t.pct}%`)
      : `${t.pct}% to ${fmtThreshold(t.up_to)}`
  ));
  return `${parts.join(', ')}${mode === 'bracket' ? ' (whole price)' : ''}`;
}

/** Summary of a whole schedule, e.g. 'Cars 12% to $250k, then 10% · Motorcycles 20% flat'. */
export function describeFeeSchedule(schedule) {
  if (!schedule || !schedule.categories) return '—';
  return Object.entries(schedule.categories)
    .map(([key, set]) => `${categoryLabel(key)} ${describeTierSet(set)}`)
    .join(' · ');
}
