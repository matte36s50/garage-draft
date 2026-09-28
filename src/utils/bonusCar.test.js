import { bonusPrize, bonusResult, decideBonus } from './bonusCar'

const calls = [
  { user_id: 'a', predicted_price: 60500 },
  { user_id: 'b', predicted_price: 64000 },
  { user_id: 'c', predicted_price: 70000 },
]

test('the prize is 5% of the event budget', () => {
  expect(bonusPrize(200000)).toBe(10000)
  expect(bonusPrize(175000)).toBe(8750)
  expect(bonusPrize(undefined)).toBe(0)
})

test('nothing is paid while the auction is still running or awaiting its result', () => {
  const live = { current_bid: 61000, final_price: null, reserve_not_met: false }
  expect(bonusResult(live)).toEqual({ settled: false, price: null })
  expect(decideBonus({ auction: live, predictions: calls, budget: 200000 }).winners).toEqual([])
})

test('a sale pays the closest call the whole prize', () => {
  const sold = { current_bid: 63000, final_price: 63000, reserve_not_met: false }
  expect(decideBonus({ auction: sold, predictions: calls, budget: 200000 })).toEqual({
    settled: true, price: 63000, prize: 10000, winners: ['b'], share: 10000,
  })
})

test('a no-sale is judged on the high bid', () => {
  const noSale = { current_bid: 59000, final_price: null, reserve_not_met: true }
  const outcome = decideBonus({ auction: noSale, predictions: calls, budget: 200000 })
  expect(outcome.price).toBe(59000)
  expect(outcome.winners).toEqual(['a'])
})

test('a withdrawn lot pays nothing', () => {
  const withdrawn = { current_bid: 40000, final_price: 0, reserve_not_met: false }
  const outcome = decideBonus({ auction: withdrawn, predictions: calls, budget: 200000 })
  expect(outcome.settled).toBe(true)
  expect(outcome.winners).toEqual([])
})

test('tied calls split the prize', () => {
  const sold = { final_price: 65000 }
  const tied = [{ user_id: 'a', predicted_price: 64000 }, { user_id: 'b', predicted_price: 66000 }, { user_id: 'c', predicted_price: 70000 }]
  const outcome = decideBonus({ auction: sold, predictions: tied, budget: 200000 })
  expect(outcome.winners).toEqual(['a', 'b'])
  expect(outcome.share).toBe(5000)
})

test('no calls means no winner', () => {
  expect(decideBonus({ auction: { final_price: 65000 }, predictions: [], budget: 200000 }).winners).toEqual([])
})
