// Run: npm test (node --test). Mirrors src/utils/bonusCar.test.js in the player app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusPrize, decideBonus } from '../bonusCar.js';

const calls = [
  { user_id: 'a', predicted_price: 60500 },
  { user_id: 'b', predicted_price: 64000 },
  { user_id: 'c', predicted_price: 70000 },
];

test('the prize is 5% of the event budget', () => {
  assert.equal(bonusPrize(200000), 10000);
  assert.equal(bonusPrize(175000), 8750);
});

test('nothing is paid until the auction has a confirmed result', () => {
  const ended = { current_bid: 61000, final_price: null, reserve_not_met: false };
  assert.deepEqual(decideBonus({ auction: ended, predictions: calls, budget: 200000 }).winners, []);
});

test('a sale pays the closest call the whole prize', () => {
  const outcome = decideBonus({ auction: { final_price: 63000 }, predictions: calls, budget: 200000 });
  assert.deepEqual(outcome.winners, ['b']);
  assert.equal(outcome.share, 10000);
});

test('a no-sale is judged on the high bid; a withdrawn lot pays nothing', () => {
  const noSale = decideBonus({ auction: { current_bid: 59000, final_price: null, reserve_not_met: true }, predictions: calls, budget: 200000 });
  assert.deepEqual(noSale.winners, ['a']);
  const withdrawn = decideBonus({ auction: { current_bid: 40000, final_price: 0 }, predictions: calls, budget: 200000 });
  assert.deepEqual(withdrawn.winners, []);
});

test('tied calls split the prize', () => {
  const tied = [{ user_id: 'a', predicted_price: 64000 }, { user_id: 'b', predicted_price: 66000 }];
  const outcome = decideBonus({ auction: { final_price: 65000 }, predictions: tied, budget: 200000 });
  assert.deepEqual(outcome.winners, ['a', 'b']);
  assert.equal(outcome.share, 5000);
});
