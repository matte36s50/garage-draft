// Run: npm test (node --test). Pure functions, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  watchListingId, eventNameFromTitle, parseSaleDates, shouldCapture, resultsDue, resultsPosted, chooseSaleDates,
  estimatesOnly, buildIngestItems, lotsToSend, majorityCurrency, stableLotText, LOT_MARKER, HOUSES,
  lotKey, markUnsold, UNSOLD_BASIS,
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

test('Gooding: a sale\'s catalogue is the lots list filtered to it, named from the filter', () => {
  const H = HOUSES;
  const linked = 'https://www.goodingco.com/lots/?filtersInput%5BauctionType%5D%5B0%5D=Live%20Auction&filtersInput%5BauctionYear%5D%5B0%5D=2027'
    + '&filtersInput%5BliveAuctionVenue%5D%5B0%5D=R%C3%A9tromobile%20Paris&sortBy=ENDING_SOONEST';
  assert.ok(H.gooding.catalogue.test(linked));
  const canonical = H.gooding.catalogueUrl(linked);
  assert.doesNotMatch(canonical, /sortBy/);
  assert.equal(H.gooding.catalogueUrl(`${linked}&page=2`), canonical);
  assert.equal(H.gooding.eventName(canonical), 'Rétromobile Paris 2027');
  assert.ok(H.gooding.follow.test('https://www.goodingco.com/auction/retromobile-new-york-auctions-2026'));
  assert.ok(!H.gooding.follow.test('https://www.goodingco.com/auction/realized/retromobile-paris-2026'));
});

test('online sales: a stated closing date is the end, so results wait for bidding to close', () => {
  // Broad Arrow's Global Icons: Zoute Online 2026 opened 5 October and closed on the 14th.
  assert.deepEqual(
    parseSaleDates('Global Icons: Zoute Online 2026 Opens 5 October 2026. Bidding begins to close at 17:00 CET on Wednesday, 14 October.'),
    { starts_on: '2026-10-05', ends_on: '2026-10-14' });
  assert.deepEqual(parseSaleDates('Online 5 October 2026 | Closes 14 October 2026'), { starts_on: '2026-10-05', ends_on: '2026-10-14' });
  // As Broad Arrow's upcoming-sales page words it.
  assert.deepEqual(parseSaleDates('Global Icons: Zoute Online 2026 · 5 October 2026 · Online · Closing at 5 PM CEST on 14 October 2026'),
    { starts_on: '2026-10-05', ends_on: '2026-10-14' });
  assert.deepEqual(parseSaleDates('Sale 28 December 2026, bidding closes 3 January'), { starts_on: '2026-12-28', ends_on: '2027-01-03' });
  // Dates in a lot's history are not a closing date, nor is one more than two months on.
  assert.deepEqual(parseSaleDates('Monterey 14 & 15 August 2026. Raced until it ended its career 4 May 1970'),
    { starts_on: '2026-08-14', ends_on: '2026-08-15' });
  assert.deepEqual(parseSaleDates('Opens 5 October 2026 closing 20 December 2026'), { starts_on: '2026-10-05', ends_on: '2026-10-05' });
});

test('sale dates for a run: the page first, so a wrongly recorded end is corrected; the store only as a start', () => {
  const recorded = { starts_on: '2026-10-05', ends_on: '2026-10-05' };
  const page = { starts_on: '2026-10-05', ends_on: '2026-10-14' };
  assert.deepEqual(chooseSaleDates({ page, recorded }), page);
  assert.deepEqual(chooseSaleDates({ page: null, recorded }), recorded);
  assert.deepEqual(chooseSaleDates({ page: null, recorded: {}, store: { starts_on: '2026-10-05' } }),
    { starts_on: '2026-10-05', ends_on: '2026-10-05' });
  assert.equal(chooseSaleDates({ page: null, recorded: {} }), null);
});

test('a results page where nothing sold is held, and re-read only when the page changes', () => {
  assert.equal(resultsPosted([{ outcome: 'reserve_not_met' }, { outcome: null }]), false);
  assert.equal(resultsPosted([]), false);
  assert.equal(resultsPosted([{ outcome: 'reserve_not_met' }, { outcome: 'sold', price: 1 }]), true);

  const sale = { starts_on: '2026-10-05', ends_on: '2026-10-05' };
  const held = { resultsHeldHash: 'coming-soon' };
  assert.equal(resultsDue(held, { hash: 'coming-soon', today: '2026-10-08', sale }).due, false);
  assert.equal(resultsDue(held, { hash: 'results-up', today: '2026-10-15', sale }).due, true);
  // Held well past the usual two-week window, a changed page is still read.
  assert.equal(resultsDue(held, { hash: 'results-up', today: '2026-11-20', sale }).due, true);
});

test('estimate re-reads send only new or changed lots, and only new lots once the sale is under way', () => {
  const sale = { starts_on: '2026-10-31', ends_on: '2026-10-31' };
  const hashes = new Map([['a', 'h1'], ['b', 'h2'], ['c', 'h3']]);
  const candidates = ['a', 'b', 'c'];
  const pick = (entry, today = '2026-10-25', s = sale) => lotsToSend({ entry, mode: 'estimate', sale: s, today, candidates, hashes });

  // Everything: first capture, no per-lot record yet, or the sale's dates moved.
  assert.deepEqual(pick(undefined), { urls: candidates, partial: false, why: 'all lots: first capture' });
  const recorded = { capturedAt: '2026-10-20', ...sale };
  assert.equal(pick(recorded).why, 'all lots: no per-lot record yet');
  assert.equal(pick({ ...recorded, lotHashes: { a: 'h1', b: 'h2', c: 'h3' } }, '2026-10-25', { starts_on: '2026-11-04', ends_on: '2026-11-04' }).why,
    'all lots: sale dates changed');

  // Before the sale: new lots (c) and changed lots (b).
  const known = { ...recorded, lotHashes: { a: 'h1', b: 'old' } };
  assert.deepEqual(pick(known), { urls: ['b', 'c'], partial: true, why: '2 of 3 lots new or changed' });
  // Nothing new or changed: nothing to send.
  assert.deepEqual(pick({ ...recorded, lotHashes: { a: 'h1', b: 'h2', c: 'h3' } }).urls, []);
  // Under way (bids and countdowns change the cards): new lots only.
  assert.deepEqual(pick(known, '2026-10-31').urls, ['c']);
  assert.deepEqual(pick({ ...recorded, lotHashes: { a: 'x', b: 'y', c: 'z' } }, '2026-10-31').urls, []);
});

test('an online sale under way: bids change every card daily, but only lots added since the last read are sent', () => {
  const sale = { starts_on: '2026-10-05', ends_on: '2026-10-14' };
  const entry = { capturedAt: '2026-10-04', ...sale, lotHashes: { a: 'bid-1', b: 'bid-1' } };
  const hashes = new Map([['a', 'bid-9'], ['b', 'bid-7'], ['n', 'new']]);
  const pick = lotsToSend({ entry, mode: 'estimate', sale, today: '2026-10-09', candidates: ['a', 'b', 'n'], hashes });
  assert.deepEqual(pick.urls, ['n']);
  assert.equal(pick.partial, true);
});

test('results: the whole page on the first pass, then only lots that changed since it', () => {
  const sale = { starts_on: '2026-10-31', ends_on: '2026-10-31' };
  const hashes = new Map([['a', 'sold'], ['b', 'sold-after']]);
  const pick = (entry) => lotsToSend({ entry, mode: 'result', sale, today: '2026-11-03', candidates: ['a', 'b'], hashes });
  assert.deepEqual(pick({ capturedAt: '2026-10-30' }), { urls: ['a', 'b'], partial: false, why: 'all lots: first results pass' });
  // A held read (results weren't up) is still a first pass.
  assert.equal(pick({ resultsHeldHash: 'x' }).partial, false);
  assert.equal(pick({ resultsAt: '2026-11-01' }).why, 'all lots: no per-lot record of the results pass');
  assert.deepEqual(pick({ resultsAt: '2026-11-01', resultHashes: { a: 'sold', b: 'not-sold' } }),
    { urls: ['b'], partial: true, why: '1 of 2 lots changed since the results pass' });
});

test('the sale currency is what most lots state', () => {
  assert.equal(majorityCurrency([{ currency: 'chf' }, { currency: 'CHF' }, { currency: 'EUR' }, { currency: null }]), 'CHF');
  assert.equal(majorityCurrency([{ currency: null }, {}]), undefined);
  assert.equal(majorityCurrency(undefined), undefined);
});

test('a lot card is the same lot whatever its countdown and running bid say', () => {
  // Broad Arrow online, as the watch read it on 12 October 2026, and a day later.
  const card = (left, bid) => `[lot: https://bid.broadarrowauctions.com/lots/view/1-DH4AXC/1980-bmw-328-junior-stimula]
1980 BMW 328 Junior Stimula
101
${left}
1980 BMW 328 JUNIOR STIMULA
Est. 
€12,000 - €18,000
Current bid: ${bid}
PLACE BID`;
  const today = card('1d 18h 28m 33s left', '€4,800');
  const tomorrow = card('18h 4m 2s left', '€6,100');
  assert.equal(stableLotText(today), stableLotText(tomorrow));
  assert.match(stableLotText(today), /€12,000 - €18,000/); // the estimate is kept
  // A revised estimate is a change.
  assert.notEqual(stableLotText(today), stableLotText(today.replace('€12,000 - €18,000', '€14,000 - €20,000')));

  // Other wordings: bid counts, high/starting bids, clock countdowns, "closes in".
  assert.equal(stableLotText('Lot 7 | Est. $80,000 - $100,000 | High Bid $41,000 | 9 bids | Closes in 3 days'),
    stableLotText('Lot 7 | Est. $80,000 - $100,000 | High Bid $57,500 | 14 bids | Closes in 2 days'));
  assert.equal(stableLotText('Lot 8 | Starting bid €10,000 | 02:14:09'), stableLotText('Lot 8 | Starting bid €12,000 | 01:59:30'));
  assert.equal(stableLotText('Lot 9 | Est. £40,000 - £60,000 | 4 days left'), stableLotText('Lot 9 | Est. £40,000 - £60,000 | 3 days left'));
  assert.equal(stableLotText('Lot 9 | 2 Days 4 Hrs remaining'), stableLotText('Lot 9 | 1 Day 22 Hrs remaining'));
  // A number that isn't a time left stays: "4 seats", "500 hours since restoration".
  assert.notEqual(stableLotText('Lot 9 | 500 hours since restoration'), stableLotText('Lot 9 | 400 hours since restoration'));
  // What follows a countdown on the same line, or on the next, still counts.
  const est = (e) => `Lot 9 | Closes in 3 days · Est. ${e}\nCurrent bid: €1,000`;
  assert.notEqual(stableLotText(est('€12,000 - €18,000')), stableLotText(est('€14,000 - €20,000')));
  assert.notEqual(stableLotText('Opens in 6d 4h\nEst. €12,000 - €18,000'), stableLotText('Opens in 5d 4h\nEst. €14,000 - €20,000'));
  assert.equal(stableLotText('Opens in 6d 4h\nEst. €12,000 - €18,000'), stableLotText('Opens in 5d 2h\nEst. €12,000 - €18,000'));
  // A lot's own numbers stay: lot number, year, model designations.
  assert.match(stableLotText('Lot 104 | 1973 Porsche 911 Carrera RS 2.7 Touring'), /Lot 104 \| 1973 Porsche 911 Carrera RS 2\.7 Touring/);
});

test('for results, a high bid is part of the lot; a countdown still is not', () => {
  assert.notEqual(stableLotText('Lot 23 | Not sold | High bid €2,000,000', 'result'),
    stableLotText('Lot 23 | Not sold | High bid €2,100,000', 'result'));
  assert.notEqual(stableLotText('Lot 23 | Not sold | High bid €2,000,000', 'result'),
    stableLotText('Lot 23 | Sold after auction €2,400,000', 'result'));
  assert.equal(stableLotText('Lot 23 | Sold €2,400,000 | 0d 0h 4m 10s left', 'result'), stableLotText('Lot 23 | Sold €2,400,000 | 0d 0h 0m 0s left', 'result'));
});

test('RM: any link into a sale names its catalogue; press releases are followed but never date the sale', () => {
  const rm = HOUSES.rm;
  const canon = (u) => (rm.catalogue.test(u) ? rm.catalogueUrl(u) : null);
  assert.equal(canon('https://rmsothebys.com/auctions/az27/lots/?Collection=The%20Groendyke%20Collection'), 'https://rmsothebys.com/auctions/az27/lots/');
  assert.equal(canon('https://rmsothebys.com/auctions/pa27/lots/r0023-1970-mercedesbenz-c-111ii/'), 'https://rmsothebys.com/auctions/pa27/lots/');
  assert.equal(canon('https://rmsothebys.com/auctions/BC27/'), 'https://rmsothebys.com/auctions/bc27/lots/');
  assert.equal(canon('https://rmsothebys.com/auctions/mu26/lots/'), 'https://rmsothebys.com/auctions/mu26/lots/');
  assert.equal(canon('https://rmsothebys.com/auctions/?utm_source=website'), null);
  assert.equal(canon('https://sealed.rmsothebys.com/ps00/inventory/r6617-1957-bmw-507-roadster-series-ii/'), null);
  assert.ok(rm.index.includes('https://rmsothebys.com/media-center/press-releases/'));
  assert.ok(rm.follow.test('https://rmsothebys.com/media-center/press-releases/rm-sotheby-s-returns-to-munich-with-exceptional-offering-of-fine-cars/'));
  assert.ok(!rm.follow.test('https://rmsothebys.com/media-center/press-releases/'));
  assert.equal(rm.followIsSalePage, false);
});

test('lot keys match a card to its extracted lot whatever the slash, case or query', () => {
  assert.equal(lotKey('https://www.goodingco.com/lot/1956-jaguar-d-type/'), lotKey('https://www.goodingco.com/lot/1956-Jaguar-D-Type?x=1'));
  assert.notEqual(lotKey('https://www.goodingco.com/lot/1956-jaguar-d-type/'), lotKey('https://www.goodingco.com/lot/1956-jaguar-c-type/'));
});

test('results: a lot shown only as offered privately after the sale is a no-sale with no price', () => {
  const dtype = 'https://www.goodingco.com/lot/1956-jaguar-d-type/';
  const xj = 'https://www.goodingco.com/lot/1993-jaguar-xj220-rn26/';
  const open = 'https://www.goodingco.com/lot/1975-yamaha-xs650/';
  const cards = new Map([
    [lotKey(dtype), `${LOT_MARKER}${dtype}]\nLOT 52 AVAILABLE Follow 2026 | Retromobile New York Auctions 1956 Jaguar D-Type Price Available Upon Request`],
    [lotKey(xj), `${LOT_MARKER}${xj}]\nLOT 20 2026 | Retromobile New York Auctions 1993 Jaguar XJ220 SOLD $516,500`],
    [lotKey(open), `${LOT_MARKER}${open}]\nLOT 9 1975 Yamaha XS650`],
  ]);
  const lots = [
    { lot_url: dtype, make: 'Jaguar', model: 'D-Type', outcome: null, price: null, currency: 'USD' },
    { lot_url: xj, make: 'Jaguar', model: 'XJ220', outcome: 'sold', price: 516500, currency: 'USD' },
    { lot_url: open, make: 'Yamaha', model: 'XS650', outcome: null, price: null },
  ];
  const { lots: out, marked } = markUnsold(lots, cards, HOUSES.gooding.unsold);
  assert.equal(marked, 1);
  assert.equal(out[0].outcome, 'reserve_not_met');
  assert.equal(out[0].price, null);
  assert.equal(out[0].outcome_basis, UNSOLD_BASIS);
  assert.equal(out[1], lots[1]); // a stated outcome stands
  assert.equal(out[2].outcome, null); // no mark, no outcome

  const event = { name: 'Rétromobile New York 2026', starts_on: '2026-11-20', ends_on: '2026-11-21' };
  const { items, skipped } = buildIngestItems({ houseId: 'gooding', event, catalogueUrl: 'x', mode: 'result', lots: out, today: '2026-11-22' });
  const d = items.find((i) => i.payload.model === 'D-Type').payload;
  assert.equal(d.outcome, 'reserve_not_met');
  assert.equal(d.current_bid, undefined);
  assert.equal(d.price_all_in, undefined);
  assert.equal(d.outcome_basis, UNSOLD_BASIS);
  assert.deepEqual(skipped.map((s) => s.reason), ['no result on the page']);

  // RM's post-sale card: an asking price, never recorded as a bid.
  const csl = 'https://rmsothebys.com/auctions/mu26/lots/r0076-1971-bmw-30-csl-batmobile/';
  const rm = markUnsold(
    [{ lot_url: csl, make: 'BMW', model: "3.0 CSL 'Batmobile'", outcome: null, price: 320000, currency: 'EUR' }],
    new Map([[lotKey(csl), "The Munich Auction 2026 1971 BMW 3.0 CSL 'Batmobile' Lot 147 | €320,000 EUR Asking"]]),
    HOUSES.rm.unsold,
  );
  assert.equal(rm.lots[0].outcome, 'reserve_not_met');
  assert.equal(rm.lots[0].price, null);
  // Before the sale an RM card never says "asking"; a house without a mark is left alone.
  assert.ok(!HOUSES.rm.unsold.test('Lot 147 | €380,000 - €480,000 EUR | Offered Without Reserve'));
  assert.equal(markUnsold(lots, cards, undefined).marked, 0);
});
