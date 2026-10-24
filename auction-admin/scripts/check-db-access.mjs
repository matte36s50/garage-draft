#!/usr/bin/env node
/**
 * Database access check: what the public anon key can do against the game
 * database, as any visitor to the player app could.
 *
 * Run it after supabase_migration_lock_down_rls.sql. Every line should read
 * "ok". A "HOLE" means the anon key could do something it shouldn't.
 *
 * Every probe is harmless whatever the database allows: reads ask for at
 * most one row, updates and deletes match no row, and inserts carry an id
 * that isn't a valid uuid. Postgres checks privileges before it reads the
 * row, so a locked table answers 42501; an open one fails on the bad id
 * (22P02) and still writes nothing.
 *
 *   SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<anon key> \
 *     node scripts/check-db-access.mjs
 *
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY work too. Use the
 * same anon key the player app ships in src/App.js.
 */

const NIL = '00000000-0000-0000-0000-000000000000';
const BAD_ID = 'access-check-not-a-uuid';
const DENIED = '42501';

// [label, method, path, body, expect]. expect 'denied' = refused for lack of
// privilege or by row security; 'allowed' = the request must succeed.
export const PROBES = [
  ['read usernames', 'GET', 'users?select=id,username&limit=1', null, 'allowed'],
  ['read auctions', 'GET', 'auctions?select=auction_id&limit=1', null, 'allowed'],
  ['read leagues', 'GET', 'leagues?select=id&limit=1', null, 'allowed'],
  ['read emails', 'GET', 'users?select=email&limit=1', null, 'denied'],
  ['read bonus predictions', 'GET', 'bonus_predictions?select=id&limit=1', null, 'denied'],
  ['read chat', 'GET', 'league_messages?select=id&limit=1', null, 'denied'],
  ['read auction_notifications', 'GET', 'auction_notifications?select=id&limit=1', null, 'denied'],
  ['set a final price', 'PATCH', 'auctions?auction_id=eq.__access_check__', { final_price: null }, 'denied'],
  ['delete a league', 'DELETE', `leagues?id=eq.${NIL}`, null, 'denied'],
  ['add a car to a league', 'POST', 'league_auctions', { league_id: BAD_ID, auction_id: '__access_check__' }, 'denied'],
  ['open a garage', 'POST', 'garages', { user_id: BAD_ID, league_id: BAD_ID, remaining_budget: 0 }, 'denied'],
  ['change a budget', 'PATCH', `garages?id=eq.${NIL}`, { remaining_budget: 0 }, 'denied'],
  ['add a drafted car', 'POST', 'garage_cars', { garage_id: BAD_ID, auction_id: '__access_check__', purchase_price: 0 }, 'denied'],
  ['create a user', 'POST', 'users', { id: BAD_ID, username: '__access_check__' }, 'denied'],
  ['call get_username (emails)', 'POST', 'rpc/get_username', { p_user_id: NIL }, 'denied'],
];

/** Classify one PostgREST response against what was expected. */
export function verdict(expect, status, body) {
  const code = body && typeof body === 'object' ? body.code : undefined;
  if (expect === 'allowed') return status >= 200 && status < 300 ? 'ok' : 'BROKEN';
  // Denied: no privilege, or a row-security refusal. Anything else (2xx, or a
  // bad-id or constraint error, which only happens after access was granted)
  // means the anon key got through.
  return code === DENIED ? 'ok' : 'HOLE';
}

async function probe(base, key, [label, method, path, body, expect]) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const result = verdict(expect, res.status, parsed);
  const detail = parsed && parsed.code ? `${parsed.code} ${parsed.message || ''}`.trim() : `HTTP ${res.status}`;
  return { label, expect, result, detail };
}

async function main() {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (the anon key from src/App.js).');
    process.exit(2);
  }

  let problems = 0;
  for (const p of PROBES) {
    const r = await probe(base, key, p);
    if (r.result !== 'ok') problems++;
    console.log(`${r.result.padEnd(6)} ${r.expect === 'allowed' ? 'can   ' : "can't "} ${r.label.padEnd(30)} ${r.detail}`);
  }
  console.log(problems ? `\n${problems} problem(s). See supabase_migration_lock_down_rls.sql.` : '\nAll checks passed.');
  process.exit(problems ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
