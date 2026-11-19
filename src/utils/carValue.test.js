import { carValue } from './carValue'

test('a live car is worth its current bid', () => {
  expect(carValue({ currentBid: 31500, purchasePrice: 24000 })).toEqual({ status: 'live', value: 31500 })
})

test('a live car with no bid yet is worth what it cost', () => {
  expect(carValue({ currentBid: null, purchasePrice: 24000 }).value).toBe(24000)
})

test('a sold car is worth its hammer price', () => {
  expect(carValue({ finalPrice: 12750, currentBid: 12000, ended: true })).toEqual({ status: 'sold', value: 12750 })
})

test('a confirmed no-sale counts 25% of the high bid', () => {
  expect(carValue({ finalPrice: null, reserveNotMet: true, currentBid: 22000, ended: true })).toEqual({ status: 'no_sale', value: 5500 })
})

test('an ended car with no recorded result counts its high bid until the result is recorded', () => {
  expect(carValue({ finalPrice: null, reserveNotMet: false, currentBid: 38500, ended: true })).toEqual({ status: 'pending', value: 38500 })
})

test('in an older value event a withdrawn car is worth nothing', () => {
  expect(carValue({ finalPrice: 0, currentBid: 40000, ended: true })).toEqual({ status: 'withdrawn', value: 0 })
  expect(carValue({ finalPrice: 0, currentBid: 40000, purchasePrice: 35000, ended: true, scoring: 'value' })).toEqual({ status: 'withdrawn', value: 0 })
})

test('in a profit event a withdrawn car counts at its price, so it scores zero', () => {
  const car = { finalPrice: 0, currentBid: 400000, purchasePrice: 400000, ended: true, scoring: 'profit' }
  expect(carValue(car)).toEqual({ status: 'withdrawn', value: 400000 })
  expect(carValue(car).value - car.purchasePrice).toBe(0)
})

test('the scoring rule changes nothing but a withdrawn car', () => {
  for (const car of [
    { finalPrice: 12750, currentBid: 12000, ended: true },
    { finalPrice: null, reserveNotMet: true, currentBid: 22000, ended: true },
    { finalPrice: null, currentBid: 38500, ended: true },
    { currentBid: 31500, purchasePrice: 24000 },
  ]) {
    expect(carValue({ ...car, scoring: 'profit' })).toEqual(carValue({ ...car, scoring: 'value' }))
  }
})
