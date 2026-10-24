/**
 * Admin query relay: the admin panels' Supabase queries, run on the server.
 *
 * WHY: AdminPortal and AuctionAnalytics used to query the game database from
 * the browser with the public anon key — setting final prices, creating and
 * deleting leagues, users and garages. For that to work the database had to
 * accept those writes from anyone holding the anon key, and that key ships in
 * the player app. Now the browser records the query chain it would have run
 * (lib/supabase.js) and POSTs it to /api/admin/db, which checks the admin
 * session and replays it here with the service-role key. The database can
 * then refuse anon writes without breaking the admin panels.
 *
 * Only the tables the admin panels use and the supabase-js query-builder
 * methods are allowed; anything else is refused before it reaches Supabase.
 */

export const ALLOWED_TABLES = new Set([
  'auctions',
  'users',
  'leagues',
  'garages',
  'garage_cars',
  'league_members',
  'league_auctions',
]);

export const ALLOWED_METHODS = new Set([
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not',
  'or', 'filter', 'match', 'contains',
  'order', 'limit', 'range', 'single', 'maybeSingle',
]);

const MAX_STEPS = 40;

/**
 * Check a recorded chain: [['from', [table]], [method, args], ...].
 * Returns { table, steps } or throws with a message safe to show the admin.
 */
export function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length < 2 || chain.length > MAX_STEPS) {
    throw new Error('Query must be a from() followed by 1 to 39 steps');
  }
  const [first, ...steps] = chain;
  if (!Array.isArray(first) || first[0] !== 'from' || !Array.isArray(first[1])) {
    throw new Error('Query must start with from()');
  }
  const table = first[1][0];
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Table '${table}' is not available to the admin relay`);
  for (const step of steps) {
    if (!Array.isArray(step) || typeof step[0] !== 'string' || !Array.isArray(step[1])) {
      throw new Error('Malformed query step');
    }
    if (!ALLOWED_METHODS.has(step[0])) throw new Error(`Method '${step[0]}' is not available to the admin relay`);
  }
  return { table, steps };
}

/** Replay a validated chain on a Supabase client and return what supabase-js returns. */
export async function runChain(client, chain) {
  const { table, steps } = validateChain(chain);
  let query = client.from(table);
  for (const [method, args] of steps) {
    if (typeof query[method] !== 'function') throw new Error(`'${method}' can't follow the previous step`);
    query = query[method](...args);
  }
  const { data, error, count, status } = await query;
  return {
    data: data ?? null,
    error: error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null,
    count: count ?? null,
    status,
  };
}
