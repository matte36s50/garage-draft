// Run: npm test (node --test). Mirrors src/utils/carValue.test.js in the player app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carValue } from '../carValue.js';

test('a live car is worth its current bid', () => {
  assert.deepEqual(carValue({ currentBid: 31500, purchasePrice: 24000 }), { status: 'live', value: 31500 });
});

test('a live car with no bid yet is worth what it cost', () => {
  assert.equal(carValue({ currentBid: null, purchasePrice: 24000 }).value, 24000);
});

test('a sold car is worth its hammer price', () => {
  assert.deepEqual(carValue({ finalPrice: 12750, currentBid: 12000, ended: true }), { status: 'sold', value: 12750 });
});

test('a confirmed no-sale counts 25% of the high bid', () => {
  assert.deepEqual(carValue({ finalPrice: null, reserveNotMet: true, currentBid: 22000, ended: true }), { status: 'no_sale', value: 5500 });
});

test('an ended car with no recorded result counts its high bid until the result is recorded', () => {
  assert.deepEqual(carValue({ finalPrice: null, reserveNotMet: false, currentBid: 38500, ended: true }), { status: 'pending', value: 38500 });
});

test('a withdrawn car is worth nothing', () => {
  assert.deepEqual(carValue({ finalPrice: 0, currentBid: 40000, ended: true }), { status: 'withdrawn', value: 0 });
});
