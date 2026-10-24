// Run: npm test (node --test). Pure functions, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateChain, runChain } from '../adminDb.js';
import { ADMIN_SESSION_MESSAGE, webSessionToken } from '../adminSession.js';

// A stand-in Supabase client that records the calls replayed on it.
function fakeClient(result = { data: [{ id: 1 }], error: null, count: null, status: 200 }) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve) => resolve(result);
      return (...args) => { calls.push([prop, args]); return builder; };
    },
  });
  return { calls, client: { from: (table) => { calls.push(['from', [table]]); return builder; } } };
}

test('a recorded chain is replayed step by step on the server client', async () => {
  const { calls, client } = fakeClient();
  const chain = [['from', ['auctions']], ['update', [{ final_price: 50000 }]], ['eq', ['auction_id', 'x']]];
  const res = await runChain(client, chain);
  assert.deepEqual(calls, chain);
  assert.deepEqual(res, { data: [{ id: 1 }], error: null, count: null, status: 200 });
});

test('a Supabase error comes back as a plain object the panels can read', async () => {
  const { client } = fakeClient({ data: null, error: { message: 'boom', code: '42501', details: null, hint: null }, status: 403 });
  const res = await runChain(client, [['from', ['leagues']], ['delete', []], ['eq', ['id', 'a']]]);
  assert.equal(res.error.message, 'boom');
  assert.equal(res.error.code, '42501');
  assert.equal(res.data, null);
});

test('tables the admin panels do not use are refused', () => {
  assert.throws(() => validateChain([['from', ['league_messages']], ['select', ['*']]]), /not available/);
  assert.throws(() => validateChain([['from', ['events']], ['delete', []]]), /not available/);
});

test('only query-builder methods may follow from()', () => {
  assert.throws(() => validateChain([['from', ['auctions']], ['rpc', ['complete_league']]]), /not available/);
  assert.throws(() => validateChain([['from', ['auctions']], ['constructor', []]]), /not available/);
  assert.throws(() => validateChain([['from', ['auctions']], ['__proto__', []]]), /not available/);
});

test('malformed chains are refused before anything runs', () => {
  assert.throws(() => validateChain(null));
  assert.throws(() => validateChain([['from', ['auctions']]]), /from\(\) followed by/);
  assert.throws(() => validateChain([['select', ['*']], ['eq', ['a', 1]]]), /start with from/);
  assert.throws(() => validateChain([['from', ['auctions']], ['eq', 'a']]), /Malformed/);
});

test('the page middleware signs the session the same way the API routes do', async () => {
  // adminAuth.js signs with node:crypto, middleware.js with Web Crypto.
  const viaNode = createHmac('sha256', 'test-password').update(ADMIN_SESSION_MESSAGE).digest('hex');
  assert.equal(await webSessionToken('test-password'), viaNode);
  assert.notEqual(await webSessionToken('other-password'), viaNode);
});
