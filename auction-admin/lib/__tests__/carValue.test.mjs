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

test('in an older value event a withdrawn car is worth nothing', () => {
  assert.deepEqual(carValue({ finalPrice: 0, currentBid: 40000, ended: true }), { status: 'withdrawn', value: 0 });
  assert.deepEqual(carValue({ finalPrice: 0, currentBid: 40000, purchasePrice: 35000, ended: true, scoring: 'value' }), { status: 'withdrawn', value: 0 });
});

test('in a profit event a withdrawn car counts at its price, so it scores zero', () => {
  assert.deepEqual(carValue({ finalPrice: 0, currentBid: 400000, purchasePrice: 400000, ended: true, scoring: 'profit' }), { status: 'withdrawn', value: 400000 });
});

test('the scoring rule changes nothing but a withdrawn car', () => {
  for (const car of [
    { finalPrice: 12750, currentBid: 12000, ended: true },
    { finalPrice: null, reserveNotMet: true, currentBid: 22000, ended: true },
    { finalPrice: null, currentBid: 38500, ended: true },
    { currentBid: 31500, purchasePrice: 24000 },
  ]) {
    assert.deepEqual(carValue({ ...car, scoring: 'profit' }), carValue({ ...car, scoring: 'value' }));
  }
});
