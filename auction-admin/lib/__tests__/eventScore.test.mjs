// Run: npm test (node --test). Mirrors src/utils/eventScore.test.js in the player app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventScore, scoringOf, SCORING } from '../eventScore.js';

test('an event says its own rule; anything else is the older value rule', () => {
  assert.equal(scoringOf({ scoring: 'profit' }), SCORING.PROFIT);
  assert.equal(scoringOf({ scoring: 'value' }), SCORING.VALUE);
  assert.equal(scoringOf({}), SCORING.VALUE);
  assert.equal(scoringOf(null), SCORING.VALUE);
  assert.equal(scoringOf({ scoring: 'something-else' }), SCORING.VALUE);
});

test('value: what the garage is worth, plus the bonus prize; what was paid is ignored', () => {
  assert.equal(eventScore({ scoring: 'value', carsValue: 900000, spent: 700000 }), 900000);
  assert.equal(eventScore({ scoring: 'value', carsValue: 900000, spent: 700000, bonus: 50000 }), 950000);
});

test('profit: what the garage made over what it cost, plus the bonus prize', () => {
  assert.equal(eventScore({ scoring: 'profit', carsValue: 900000, spent: 700000 }), 200000);
  assert.equal(eventScore({ scoring: 'profit', carsValue: 900000, spent: 700000, bonus: 50000 }), 250000);
});

test('profit can finish below zero', () => {
  assert.equal(eventScore({ scoring: 'profit', carsValue: 600000, spent: 700000 }), -100000);
});

test('profit: spending more does not score more by itself', () => {
  const cautious = eventScore({ scoring: 'profit', carsValue: 550000, spent: 500000 });
  const bigSpender = eventScore({ scoring: 'profit', carsValue: 9040000, spent: 9000000 });
  assert.ok(cautious > bigSpender);
  assert.ok(
    eventScore({ scoring: 'value', carsValue: 9040000, spent: 9000000 })
      > eventScore({ scoring: 'value', carsValue: 550000, spent: 500000 }),
  );
});

test('an empty garage scores zero under either rule', () => {
  assert.equal(eventScore({ scoring: 'value', carsValue: 0, spent: 0 }), 0);
  assert.equal(eventScore({ scoring: 'profit', carsValue: 0, spent: 0 }), 0);
  assert.equal(eventScore({ scoring: 'profit' }), 0);
});
