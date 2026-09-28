// Run: npm test (node --test). No network: the USD rates are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossRate } from '../fx.js';

// USD per 1 unit, as frankfurter.dev would report for one date.
const USD = { USD: 1, EUR: 1.10, GBP: 1.25, CHF: 1.12 };
const stub = async (cur) => USD[cur];

test('same currency needs no lookup', async () => {
  const rate = await crossRate('eur', 'EUR', '2026-05-18', () => { throw new Error('looked up'); });
  assert.equal(rate, 1);
});

test('USD-quoted estimates convert into a EUR-priced lot', async () => {
  // A $1,100,000 estimate on a lot sold in euros is €1,000,000.
  const rate = await crossRate('USD', 'EUR', '2026-05-18', stub);
  assert.equal(Math.round(1100000 * rate), 1000000);
});

test('non-USD pairs cross through USD', async () => {
  const rate = await crossRate('GBP', 'EUR', '2026-05-18', stub);
  assert.ok(Math.abs(rate - 1.25 / 1.10) < 1e-12);
});

test('into USD is the plain USD rate', async () => {
  assert.equal(await crossRate('CHF', 'USD', '2026-05-18', stub), 1.12);
});
