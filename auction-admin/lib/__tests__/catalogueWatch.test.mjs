// Run: npm test (node --test). Pure functions, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  watchListingId, eventNameFromTitle, parseSaleDates, shouldCapture, resultsDue,
  estimatesOnly, buildIngestItems, LOT_MARKER,
} from '../catalogueWatch.js';

test('a lot is keyed by the house\'s own lot id, the same before and after the sale', () => {
  const before = { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0005-2004-porsche-carrera-gt/', make: 'Porsche', model: 'Carrera GT' };
  const after = { ...before, lot: '112', lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0005-2004-porsche-carrera-gt/?view=results' };
  assert.equal(watchListingId('rm', before, 'The London Auction 2026'), 'cw-rm-lf26-r0005');
  assert.equal(watchListingId('rm', after, 'The London Auction 2026'), 'cw-rm-lf26-r0005');
  assert.equal(watchListingId('rm', { lot_url: 'https://rmsothebys.com/auctions/hf26/lots/c0061-otto-fennel/' }, 'x'), 'cw-rm-hf26-c0061');
  assert.equal(watchListingId('broadarrow', { lot_url: 'https://bid.broadarrowauctions.com/lots/view/1-DGKK9P/1987-mercedes-benz-560-sl' }, 'x'),
    'cw-broadarrow-1-dgkk9p');
  assert.equal(watchListingId('mecum', { lot_url: 'https://www.mecum.com/lots/1234567/1963-ferrari/' }, 'x'), 'cw-mecum-1234567');
});

test('without a link a lot falls back to its number, then its identity, never a timestamp', () => {
  assert.equal(watchListingId('broadarrow', { lot: '193', make: 'Ferrari', model: 'LaFerrari' }, 'The Zoute Concours Auction 2026'),
    'cw-broadarrow-the-zoute-concours-auction-2026-lot-193');
  const a = watchListingId('rm', { year: 1988, make: 'Ferrari', model: 'F40' }, 'The London Auction 2026');
  assert.equal(a, 'cw-rm-the-london-auction-2026-1988-ferrari-f40');
  assert.equal(watchListingId('rm', { year: 1988, make: 'Ferrari', model: 'F40' }, 'The London Auction 2026'), a);
});

test('sale names come from the page title, without the house', () => {
  assert.equal(eventNameFromTitle("The London Auction 2026 | Available Lots | RM Sotheby's", 'rm'), 'The London Auction 2026');
  assert.equal(eventNameFromTitle('The Zoute Concours Auction 2026 | Broad Arrow Auctions', 'broadarrow'), 'The Zoute Concours Auction 2026');
  assert.equal(eventNameFromTitle("Pebble Beach Auctions 2026 | Gooding Christie's", 'gooding'), 'Pebble Beach Auctions 2026');
  assert.equal(eventNameFromTitle('Mecum Kissimmee 2027', 'mecum'), 'Kissimmee 2027');
  assert.equal(eventNameFromTitle('Monterey 2026 - Mecum Auctions', 'mecum'), 'Monterey 2026');
});

test('sale dates: the first dated mention, single days and ranges, either order', () => {
  assert.deepEqual(parseSaleDates('The London Auction 31 October 2026 London'), { starts_on: '2026-10-31', ends_on: '2026-10-31' });
  assert.deepEqual(parseSaleDates('Lot 193 | Friday, 09 October 2026 Estimate'), { starts_on: '2026-10-09', ends_on: '2026-10-09' });
  assert.deepEqual(parseSaleDates('Scottsdale January 23-31, 2027'), { starts_on: '2027-01-23', ends_on: '2027-01-31' });
  assert.deepEqual(parseSaleDates('New York November 19–22, 2026 Javits'), { starts_on: '2026-11-19', ends_on: '2026-11-22' });
  assert.deepEqual(parseSaleDates('Pebble Beach 14 & 15 August 2026'), { starts_on: '2026-08-14', ends_on: '2026-08-15' });
  assert.deepEqual(parseSaleDates('Paris 30 October – 1 November 2026'), { starts_on: '2026-10-30', ends_on: '2026-11-01' });
  assert.deepEqual(parseSaleDates('October 30 - November 1, 2026'), { starts_on: '2026-10-30', ends_on: '2026-11-01' });
  assert.equal(parseSaleDates('August 14 & 15 at the Parc du Concours'), null); // no year
  assert.equal(parseSaleDates('31 February 2026'), null);
});

test('capture: first sighting, then only a changed page, weekly until 8 days out, then daily', () => {
  const sale = { starts_on: '2026-10-31', ends_on: '2026-10-31' };
  assert.equal(shouldCapture(undefined, { hash: 'a', today: '2026-09-28', sale }).reason, 'first capture');
  const entry = { capturedAt: '2026-09-28', hash: 'a' };
  assert.equal(shouldCapture(entry, { hash: 'a', today: '2026-10-02', sale }).capture, false);
  assert.equal(shouldCapture(entry, { hash: 'b', today: '2026-10-02', sale }).capture, false);
  assert.equal(shouldCapture(entry, { hash: 'b', today: '2026-10-05', sale }).reason, 'changed; weekly refresh');
  assert.equal(shouldCapture({ capturedAt: '2026-10-22', hash: 'a' }, { hash: 'b', today: '2026-10-23', sale }).reason,
    'changed; sale within 8 days');
  assert.equal(shouldCapture({ capturedAt: '2026-10-30', hash: 'a' }, { hash: 'b', today: '2026-10-31', sale }).capture, true);
  assert.equal(shouldCapture(entry, { hash: 'b', today: '2026-11-01', sale }).reason, 'sale over');
  // No known date: weekly at most.
  assert.equal(shouldCapture(entry, { hash: 'b', today: '2026-10-01', sale: null }).capture, false);
});

test('results: the first run after the last day, then on changes for two weeks', () => {
  const sale = { starts_on: '2026-10-30', ends_on: '2026-10-31' };
  assert.equal(resultsDue({}, { hash: 'a', today: '2026-10-31', sale }).due, false);
  assert.equal(resultsDue({}, { hash: 'a', today: '2026-11-01', sale }).due, true);
  const done = { resultsAt: '2026-11-01', resultsHash: 'a' };
  assert.equal(resultsDue(done, { hash: 'a', today: '2026-11-03', sale }).due, false);
  assert.equal(resultsDue(done, { hash: 'b', today: '2026-11-03', sale }).due, true);
  assert.equal(resultsDue(done, { hash: 'b', today: '2026-11-20', sale }).due, false);
});

test('estimates-only keeps the sale header and the lots that show a range', () => {
  const text = `Kissimmee 2027 January 6-18, 2027\n${LOT_MARKER}https://m/lots/1/]\n1937 Bugatti Type 57S Estimate $9,000,000 - $11,000,000\n`
    + `${LOT_MARKER}https://m/lots/2/]\n1970 Chevrolet C10 No Reserve\n`;
  const r = estimatesOnly(text);
  assert.equal(r.kept, 1);
  assert.equal(r.dropped, 1);
  assert.match(r.text, /January 6-18, 2027/);
  assert.match(r.text, /Bugatti/);
  assert.doesNotMatch(r.text, /C10/);
});

test('estimate pass: upcoming lots in their own currency, keyed stably, as scraper writes', () => {
  const { items, skipped } = buildIngestItems({
    houseId: 'rm',
    event: { name: 'The London Auction 2026', location: 'London', starts_on: '2026-10-31', ends_on: '2026-10-31' },
    catalogueUrl: 'https://rmsothebys.com/auctions/lf26/lots/',
    mode: 'estimate',
    lots: [
      { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0005-x/', year: 2004, make: 'Porsche', model: 'Carrera GT', estimate_low: 2000000, estimate_high: 2500000, currency: 'GBP' },
      { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0009-x/', year: 1988, make: 'Ferrari', model: 'F40', estimate_low: 2400000, estimate_high: 1800000 },
      { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0010-x/', make: null, model: 'Poster' },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(skipped[0].reason, 'no make or model');
  const [gt, f40] = items;
  assert.deepEqual([gt.source_id, gt.source_listing_id, gt.entered_by], ['manual', 'cw-rm-lf26-r0005', 'scraper']);
  assert.equal(gt.payload.status, 'upcoming');
  assert.equal(gt.payload.currency, 'GBP');
  assert.equal(gt.payload.ends_at, '2026-10-31');
  assert.equal(gt.payload.event_house, "RM Sotheby's");
  assert.equal(f40.payload.currency, 'GBP'); // unstated: the sale's usual currency
  assert.deepEqual([f40.payload.estimate_low, f40.payload.estimate_high], [1800000, 2400000]);
});

test('results pass: all-in price where the house publishes it, high bid for a no-sale', () => {
  const lots = [
    { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0005-x/', make: 'Porsche', model: 'Carrera GT', outcome: 'sold', price: 2200000, currency: 'GBP' },
    { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0009-x/', make: 'Ferrari', model: 'F40', outcome: 'reserve_not_met', price: 1500000 },
    { lot_url: 'https://rmsothebys.com/auctions/lf26/lots/r0011-x/', make: 'BMW', model: 'M1', outcome: null },
  ];
  const event = { name: 'The London Auction 2026', starts_on: '2026-10-31', ends_on: '2026-10-31' };
  const { items, skipped } = buildIngestItems({ houseId: 'rm', event, catalogueUrl: 'x', mode: 'result', lots, today: '2026-11-01' });
  assert.equal(skipped[0].reason, 'no result on the page');
  const [sold, rnm] = items;
  assert.equal(sold.payload.price_all_in, 2200000);
  assert.equal(sold.payload.price, undefined);
  assert.equal(sold.payload.ended_at, '2026-10-31');
  assert.equal(rnm.payload.current_bid, 1500000);
  assert.equal(rnm.payload.price, undefined);
  assert.equal(rnm.payload.status, 'ended');

  const mecum = buildIngestItems({
    houseId: 'mecum', event, catalogueUrl: 'x', mode: 'result', today: '2026-11-01',
    lots: [{ lot_url: 'https://www.mecum.com/lots/99/x/', make: 'Ferrari', model: 'Lusso', outcome: 'sold', price: 1650000 }],
  });
  assert.equal(mecum.items[0].payload.price, 1650000);
  assert.equal(mecum.items[0].payload.premium_basis, 'unconfirmed');
});
