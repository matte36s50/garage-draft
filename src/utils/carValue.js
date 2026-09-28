/**
 * What a drafted car is worth to its owner's score right now. Ranks, the
 * Dashboard and the Garage all use this, so the same car is worth the same on
 * every screen (the hourly score cron in auction-admin applies the same rule).
 *
 *   sold            final_price > 0              the hammer price
 *   withdrawn       final_price = 0              $0
 *   no sale         reserve_not_met              25% of the high bid
 *   result pending  ended, no result recorded    25% of the high bid, until a
 *                                                sale is recorded
 *   live            still running                the current bid
 */

export const NO_SALE_SHARE = 0.25

export function carValue({ finalPrice, reserveNotMet, ended, currentBid, purchasePrice }) {
  const bid = Number(currentBid) || Number(purchasePrice) || 0
  const final = finalPrice == null ? null : Number(finalPrice)
  if (final > 0) return { status: 'sold', value: final }
  if (final === 0) return { status: 'withdrawn', value: 0 }
  if (reserveNotMet) return { status: 'no_sale', value: bid * NO_SALE_SHARE }
  if (ended) return { status: 'pending', value: bid * NO_SALE_SHARE }
  return { status: 'live', value: bid }
}
