// Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventCompletion } from '../eventCompletion.js';

const HOUR = 3600;
const now = Date.UTC(2026, 8, 28, 12);
const nowSec = now / 1000;
const draftEndsAt = new Date(now - 5 * 24 * HOUR * 1000).toISOString();

const endedAgo = hours => nowSec - hours * HOUR;
const sold = { final_price: 42000, reserve_not_met: false, timestamp_end: endedAgo(10) };
const noSale = { final_price: null, reserve_not_met: true, timestamp_end: endedAgo(10) };
const awaiting = hours => ({ final_price: null, reserve_not_met: false, timestamp_end: endedAgo(hours) });
const live = { final_price: null, reserve_not_met: false, timestamp_end: nowSec + 2 * HOUR };

const check = (cars, extra = {}) => eventCompletion({ draftEndsAt, cars, now, ...extra });

test('an event closes once every car has a result', () => {
  const withdrawnEarly = { final_price: 0, reserve_not_met: false, timestamp_end: nowSec + 5 * HOUR };
  assert.deepEqual(check([sold, noSale, withdrawnEarly]), { ready: true, reason: 'results_in', missing: 0 });
});

test('an event stays open while any car is still at auction', () => {
  assert.equal(check([sold, live]).reason, 'auctions_running');
});

test('an event waits for a result that has not been recorded yet', () => {
  assert.deepEqual(check([sold, awaiting(3)]), { ready: false, reason: 'awaiting_results', missing: 1 });
});

test('after 48 hours without a result the event closes anyway', () => {
  assert.equal(check([sold, awaiting(47)]).ready, false);
  assert.deepEqual(check([sold, awaiting(48)]), { ready: true, reason: 'grace_expired', missing: 1 });
});

test('the wait counts from the most recent auction still missing a result', () => {
  assert.equal(check([awaiting(60), awaiting(5)]).reason, 'awaiting_results');
});

test('the bonus auction has to finish and settle too', () => {
  assert.equal(check([sold], { bonusAuction: live }).reason, 'auctions_running');
  assert.equal(check([sold], { bonusAuction: awaiting(2) }).reason, 'awaiting_results');
  assert.equal(check([sold], { bonusAuction: sold }).ready, true);
});

test('nothing closes before the draft ends, or with no cars drafted', () => {
  assert.equal(check([sold], { draftEndsAt: new Date(now + HOUR * 1000).toISOString() }).reason, 'draft_open');
  assert.equal(check([sold], { draftEndsAt: null }).reason, 'draft_open');
  assert.equal(check([]).reason, 'no_cars');
});
