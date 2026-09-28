// Run: npm test (node --test). Pure functions, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normMake, modelTokens, lotNumber, scorePair, matchLots,
  houseKey, suggestDuplicateEvents, preferredDirection,
} from '../lotMatch.js';

test('makes normalize across spellings', () => {
  assert.equal(normMake('Mercedes-Benz'), 'mercedes benz');
  assert.equal(normMake('Mercedes'), 'mercedes benz');
  assert.equal(normMake('VW'), 'volkswagen');
  assert.equal(normMake('Ferrari'), 'ferrari');
});

test('model tokens split letters from digits and drop make and year', () => {
  assert.deepEqual([...modelTokens({ make: 'Mercedes-Benz', model: '300SL Gullwing', year: 1955 })],
    ['300', 'sl', 'gullwing']);
  assert.deepEqual([...modelTokens({ make: 'Porsche', model: 'Porsche 911 1973', year: 1973 })], ['911']);
  assert.deepEqual([...modelTokens({ model: 'Coupé by Pininfarina' })], ['coupe', 'pininfarina']);
});

test('lot numbers come from the field or a Live Entry id, normalized', () => {
  assert.equal(lotNumber({ lot: '012' }), '12');
  assert.equal(lotNumber({ lot: 'Lot 112A' }), '112a');
  assert.equal(lotNumber({ source_listing_id: 'rm-monterey-auction-2026-lot-112' }), '112');
  assert.equal(lotNumber({ source_listing_id: 'manual_1712345' }), null);
});

test('matching lot numbers decide a pair; different ones rule it out', () => {
  const a = { source_listing_id: 'x-lot-7', make: 'BMW', model: 'M1', year: 1980 };
  assert.equal(scorePair(a, { lot: '7', make: 'Ferrari', model: 'F40' }).score, 1);
  assert.equal(scorePair(a, { lot: '8', make: 'BMW', model: 'M1', year: 1980 }).score, 0);
});

test('a known year or make that differs rules a pair out', () => {
  const rs = { make: 'Porsche', model: '911 Carrera RS', year: 1973 };
  assert.equal(scorePair(rs, { make: 'Porsche', model: '911 Carrera RS', year: 1974 }).score, 0);
  assert.equal(scorePair(rs, { make: 'Ferrari', model: '911 Carrera RS', year: 1973 }).score, 0);
});

test('the same car described differently still matches', () => {
  const s = scorePair(
    { make: 'Porsche', model: '911 Carrera RS', year: 1973 },
    { make: 'Porsche', model: '911 Carrera RS 2.7 Touring', year: 1973 });
  assert.ok(s.score >= 0.65, `score ${s.score}`);
  const g = scorePair(
    { make: 'Mercedes', model: '300 SL', year: 1955 },
    { make: 'Mercedes-Benz', model: '300SL Gullwing', year: 1955 });
  assert.ok(g.score >= 0.65, `score ${g.score}`);
});

test('different cars of the same make and year do not match', () => {
  const s = scorePair(
    { make: 'Porsche', model: '911 Carrera RS', year: 1973 },
    { make: 'Porsche', model: '911 Speedster', year: 1973 });
  assert.ok(s.score < 0.65, `score ${s.score}`);
});

test('matching is one-to-one and reports what is left over', () => {
  const existing = [
    { id: 'e1', make: 'BMW', model: 'M1', year: 1980 },
    { id: 'e2', make: 'Ferrari', model: 'F40', year: 1990 },
    { id: 'e3', make: 'Jaguar', model: 'E-Type Series 1', year: 1962 },
  ];
  const incoming = [
    { id: 'n1', make: 'Ferrari', model: 'F40', year: 1990 },
    { id: 'n2', make: 'BMW', model: 'M1 Procar', year: 1980 },
    { id: 'n3', make: 'Lancia', model: 'Stratos', year: 1975 },
  ];
  const r = matchLots(existing, incoming);
  const pairs = Object.fromEntries(r.matches.map((m) => [m.incoming.id, m.existing.id]));
  assert.deepEqual(pairs, { n1: 'e2', n2: 'e1' });
  assert.deepEqual(r.unmatchedExisting.map((x) => x.id), ['e3']);
  assert.deepEqual(r.unmatchedIncoming.map((x) => x.id), ['n3']);
  assert.equal(r.matches.find((m) => m.incoming.id === 'n1').confidence, 'high');
});

test('two identical cars in one sale are matched but flagged for a human', () => {
  const car = { make: 'Mercedes-Benz', model: '300 SL Gullwing', year: 1955 };
  const r = matchLots([{ id: 'e1', ...car }, { id: 'e2', ...car }], [{ id: 'n1', ...car }, { id: 'n2', ...car }]);
  assert.equal(r.matches.length, 2);
  assert.ok(r.matches.every((m) => m.confidence === 'check'));
});

// The 20 events in the production store on 2026-09-28 (Sales query output).
const PROD_EVENTS = [
  ['Gooding Monterey 2026', 'Gooding', '2026-08-15', 167, 167],
  ['RM Monterey Auction 2026', 'RM Sothebys', '2026-08-15', 193, 0],
  ['Bonhams Leguna Seca', 'Bonhams', '2026-08-13', 48, 12],
  ['Air/Water', 'Broad Arrow', '2026-07-24', 60, 0],
  ['The Monaco Auction', 'RM Sothebys', '2026-07-19', 58, 7],
  ['THE TEGERNSEE AUCTION', 'RM Sothebys', '2026-07-19', 19, 0],
  ["Broad Arrow Villa d'Este 2026", "Broad Arrow Villa d'Este 2026", '2026-05-18', 61, 0],
  ['Broad Arrow Porsche Air|Water 2026', 'Broad Arrow Porsche Air|Water 2026', '2026-04-26', 62, 0],
  ['RM Monaco 2026', 'RM Monaco 2026', '2026-04-24', 55, 0],
  ['Gooding Amelia Island 2026', 'Gooding Amelia Island 2026', '2026-03-07', 134, 0],
  ['Broad Arrow Amelia 2026', 'Broad Arrow Amelia 2026', '2026-03-06', 3, 0],
  ['Broad Arrow Amelia Island 2026', 'Broad Arrow Amelia Island 2026', '2026-03-06', 102, 0],
  ['RM Miami 2026', 'RM Miami 2026', '2026-02-27', 58, 0],
  ['Christies Retromobile 2026', 'Christies Retromobile 2026', '2026-01-30', 1, 0],
  ['Gooding Retromobile', 'Gooding Retromobile', '2026-01-30', 1, 0],
  ['Gooding Retromobile 2025', 'Gooding Retromobile 2025', '2026-01-29', 1, 0],
  ['Gooding Retromobile 2026', 'Gooding Retromobile 2026', '2026-01-29', 52, 0],
  ['RM Retromobile 2026', 'RM Retromobile 2026', '2026-01-28', 4, 0],
  ['RM Arizon 2026', 'RM Arizon 2026', '2026-01-24', 1, 0],
  ['RM Arizona 2026', 'RM Arizona 2026', '2026-01-24', 23, 0],
].map(([name, house, first_date, lots, with_estimate]) => ({ id: name, name, house, first_date, lots, with_estimate }));

test('house keys see through game-style names and the Christie\'s rename', () => {
  const byName = Object.fromEntries(PROD_EVENTS.map((e) => [e.name, houseKey(e)]));
  assert.equal(byName['Air/Water'], 'broad');
  assert.equal(byName['Broad Arrow Porsche Air|Water 2026'], 'broad');
  assert.equal(byName['Christies Retromobile 2026'], 'gooding');
  assert.equal(byName['The Monaco Auction'], 'rm');
});

test('the production duplicates are suggested, and different houses are not', () => {
  const key = (p) => [p.from.name, p.into.name].sort().join(' + ');
  const got = new Set(suggestDuplicateEvents(PROD_EVENTS).map(key));
  for (const want of [
    'Air/Water + Broad Arrow Porsche Air|Water 2026',
    'RM Monaco 2026 + The Monaco Auction',
    'Broad Arrow Amelia 2026 + Broad Arrow Amelia Island 2026',
    'Gooding Retromobile + Gooding Retromobile 2026',
    'Christies Retromobile 2026 + Gooding Retromobile 2026',
    'RM Arizon 2026 + RM Arizona 2026',
  ]) {
    assert.ok(got.has(want), `missing suggestion: ${want}`);
  }
  for (const never of [
    'Broad Arrow Amelia Island 2026 + Gooding Amelia Island 2026',
    'Gooding Monterey 2026 + RM Monterey Auction 2026',
    'RM Monaco 2026 + RM Monterey Auction 2026',
  ]) {
    assert.ok(!got.has(never), `wrong suggestion: ${never}`);
  }
});

test('merge direction keeps the Live Entry copy', () => {
  const live = PROD_EVENTS.find((e) => e.name === 'The Monaco Auction');
  const game = PROD_EVENTS.find((e) => e.name === 'RM Monaco 2026');
  assert.equal(preferredDirection(game, live).into.name, 'The Monaco Auction');
  const typo = PROD_EVENTS.find((e) => e.name === 'RM Arizon 2026');
  const real = PROD_EVENTS.find((e) => e.name === 'RM Arizona 2026');
  assert.equal(preferredDirection(typo, real).into.name, 'RM Arizona 2026');
});
