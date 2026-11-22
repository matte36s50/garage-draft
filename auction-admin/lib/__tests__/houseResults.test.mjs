// Run: npm test (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allInFromHammer, goodingResult, hammerFromAllIn, parseGoodingLot, saleMatches } from '../houseResults.js';

// The markup a Gooding lot page carries, trimmed to the parts that matter.
const page = ({ year = '2026', sale = 'Retromobile New York Auctions', result = 'SOLD  $3,085,000', note = '' } = {}) => `
  <style>.x{color:red}</style>
  <div class="vehicleDetails-module--modal--22nBD"><h2>${year}   |   </h2><a class="vehicleDetails-module--textWarmgray--1kY49">${sale}</a></div>
  <h1 class="vehicleDetails-module--mainHeading--7CGVQ"> 1955 Ferrari 750 Monza</h1>
  ${result ? `<div class="vehicleDetails-module--specification--ESvZf"><h2>${result}</h2></div>` : ''}
  <div class="vehicleDetails-module--specification--ESvZf"><p>Estimate</p><h2><span>$3,500,000 - $4,500,000</span></h2></div>
  ${note ? `<div class="readMoreLess-module--text--1wPvs"><div><p>${note}</p></div></div>` : ''}`;

test('the premium is 12% up to $250,000 and 10% above it', () => {
  assert.equal(allInFromHammer(100000), 112000);
  assert.equal(allInFromHammer(250000), 280000);
  assert.equal(allInFromHammer(2800000), 3085000);
});

test('the hammer price is worked back from the published price', () => {
  assert.equal(hammerFromAllIn(112000), 100000);
  assert.equal(hammerFromAllIn(280000), 250000);
  assert.equal(hammerFromAllIn(3085000), 2800000);
  assert.equal(hammerFromAllIn(16780000), 15250000);
  for (const hammer of [18000, 60000, 249000, 251000, 640000, 6500000]) {
    assert.equal(hammerFromAllIn(allInFromHammer(hammer)), hammer);
  }
  assert.equal(hammerFromAllIn(0), null);
  assert.equal(hammerFromAllIn('nope'), null);
});

test('a result counts only when the page names the same sale', () => {
  assert.ok(saleMatches('2026 | Retromobile New York Auctions', 'Gooding Retromobile New York 2026'));
  assert.ok(saleMatches('2026 | Rétromobile New York Auctions', 'Gooding Christie\'s Rétromobile New York 2026'));
  assert.ok(!saleMatches('2019 | Scottsdale Auctions 2019', 'Gooding Retromobile New York 2026'));
  assert.ok(!saleMatches('2025 | Retromobile New York Auctions', 'Gooding Retromobile New York 2026'));
  assert.ok(!saleMatches('2026 | Retromobile Paris Auctions', 'Gooding Retromobile New York 2026'));
  assert.ok(!saleMatches('', 'Gooding Retromobile New York 2026'));
});

test('a sold lot page gives the sale and the published price', () => {
  assert.deepEqual(parseGoodingLot(page()), { saleLabel: '2026 | Retromobile New York Auctions', soldAllIn: 3085000, notSold: false, withdrawn: false });
  assert.deepEqual(parseGoodingLot(page({ result: null })).soldAllIn, null);
  assert.equal(parseGoodingLot(page({ result: 'NOT SOLD' })).notSold, true);
});

// As Gooding showed Rétromobile New York 2026 lots two days after the sale.
test('an unsold lot offered privately afterwards reads as not sold', () => {
  const unsold = page({ result: 'Asking Price Price Available Upon Request' }).replace(/<p>Estimate<\/p><h2><span>[^<]*<\/span><\/h2>/, '');
  assert.equal(parseGoodingLot(unsold).notSold, true);
  assert.deepEqual(goodingResult(unsold, 'Gooding Retromobile New York 2026'), { outcome: 'not_sold' });
});

test('a withdrawn lot reads as withdrawn, even with its estimate still on the page', () => {
  const pulled = page({ result: null, note: 'Please note that this Lot has been withdrawn. ' });
  assert.equal(parseGoodingLot(pulled).withdrawn, true);
  assert.equal(parseGoodingLot(pulled).notSold, false);
  assert.deepEqual(goodingResult(pulled, 'Gooding Retromobile New York 2026'), { outcome: 'withdrawn' });
  // A page for another sale still doesn't count.
  assert.equal(goodingResult(page({ result: null, year: '2019', sale: 'Scottsdale Auctions 2019', note: 'this Lot has been withdrawn' }), 'Gooding Retromobile New York 2026').outcome, null);
});

test('before the sale a lot shows only its estimate: no result yet', () => {
  assert.deepEqual(parseGoodingLot(page({ result: null })), { saleLabel: '2026 | Retromobile New York Auctions', soldAllIn: null, notSold: false, withdrawn: false });
});

test('goodingResult: sold, not sold, someone else\'s sale, or not in yet', () => {
  const ref = 'Gooding Retromobile New York 2026';
  assert.deepEqual(goodingResult(page(), ref), { outcome: 'sold', hammer: 2800000, allIn: 3085000 });
  assert.deepEqual(goodingResult(page({ result: 'NOT SOLD' }), ref), { outcome: 'not_sold' });
  assert.equal(goodingResult(page({ year: '2019', sale: 'Scottsdale Auctions 2019' }), ref).outcome, null);
  assert.equal(goodingResult(page({ result: null }), ref).outcome, null);
  assert.equal(goodingResult('<html>blocked</html>', ref).outcome, null);
});
