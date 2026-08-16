/**
 * Automobilia detection — memorabilia, literature, parts and other non-vehicle
 * lots that must never end up in a canonical bucket.
 *
 * This is deliberately a plain keyword pass rather than an AI call: it runs
 * before anything is sent to Claude, so automobilia costs nothing to classify
 * and cannot be bucketed even if a model (or a hand-edited apply payload)
 * suggests otherwise.
 *
 * Two tiers, because the two fields carry different risk:
 *   STRONG — matched against make/model/trim AND the raw listing title. These
 *     words never appear in a real vehicle's identity ("Ferrari 250 GTO
 *     Poster", "Gulf gas globe").
 *   PARTS  — matched against make/model/trim only. A real car's raw title can
 *     legitimately say "engine" or "wheels" ("...with numbers-matching engine"),
 *     but a lot whose extracted *model* is "Engine" is a part, not a car.
 */

// Words that mark a lot as memorabilia wherever they appear.
const STRONG_TERMS = [
  'automobilia', 'memorabilia', 'petroliana',
  'poster', 'posters', 'sign', 'signs', 'signage', 'neon',
  'clock', 'thermometer', 'gas pump', 'petrol pump',
  'gas globe', 'pump globe', 'petrol globe',
  'badge', 'badges', 'emblem', 'emblems', 'hood ornament', 'mascot',
  'brochure', 'brochures', 'literature', 'catalogue',
  "owner's manual", 'owners manual', 'service manual', 'workshop manual', 'shop manual',
  'artwork', 'painting', 'paintings', 'sculpture', 'lithograph', 'photograph',
  'scale model', 'model car', 'diecast', 'die-cast', 'pedal car', 'toy', 'toys',
  'helmet', 'helmets', 'race suit', 'racing suit', 'overalls', 'jacket',
  'watch', 'watches', 'luggage', 'luggage set',
  'trophy', 'trophies', 'banner', 'pennant', 'flag',
];

// Component words — only trusted when they are the lot's extracted identity.
const PARTS_TERMS = [
  'engine', 'gearbox', 'transmission', 'carburetor', 'carburettor',
  'cylinder head', 'crankshaft', 'radiator', 'exhaust', 'manifold',
  'wheel', 'wheels', 'tire', 'tires', 'tyre', 'tyres', 'hubcap', 'hubcaps',
  'steering wheel', 'dashboard', 'grille', 'bumper', 'fender', 'body shell',
  'parts', 'spares', 'spare parts', 'part lot', 'nos',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildRe = (terms) => new RegExp(`\\b(?:${terms.map(escapeRe).join('|')})\\b`, 'i');

const STRONG_RE = buildRe(STRONG_TERMS);
const PARTS_RE = buildRe(PARTS_TERMS);

// Curly apostrophes and separator punctuation are normalised so the term list
// stays readable; \b then does the rest of the work.
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[_/|,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @param {{make?, model?, trim?, titles?: string[]}} lot
 * @returns {string|null} the matched term, or null if this looks like a vehicle
 */
export function automobiliaMatch({ make, model, trim, titles } = {}) {
  const identity = norm([make, model, trim].filter(Boolean).join(' '));
  if (identity) {
    const strong = identity.match(STRONG_RE);
    if (strong) return strong[0];
    const part = identity.match(PARTS_RE);
    if (part) return part[0];
  }
  for (const t of titles || []) {
    const hit = norm(t).match(STRONG_RE);
    if (hit) return hit[0];
  }
  return null;
}

export function isAutomobilia(lot) {
  return automobiliaMatch(lot) !== null;
}
