/**
 * Bonus car rule.
 *
 * Every event has one shared bonus auction that nobody owns. Players call its
 * final price, and the closest call wins a fixed prize worth 5% of the event
 * budget ($10,000 on a $200,000 event), added to that player's score.
 *
 * The prize is only paid once the auction has a confirmed result: a sale
 * (final_price > 0) or a no-sale (reserve_not_met, judged on the high bid).
 * A withdrawn lot (final_price = 0) pays nothing. Tied calls split the prize.
 *
 * Keep in sync with auction-admin/lib/bonusCar.js, which the hourly score cron uses.
 */

export const BONUS_PRIZE_SHARE = 0.05

export function bonusPrize(budget) {
  return Math.round((Number(budget) || 0) * BONUS_PRIZE_SHARE)
}

// { settled, price }: settled once the finalizer has recorded an outcome;
// price is what calls are judged against (null when there is nothing to judge).
export function bonusResult(auction) {
  if (!auction) return { settled: false, price: null }
  const finalPrice = auction.final_price == null ? null : Number(auction.final_price)
  if (finalPrice > 0) return { settled: true, price: finalPrice }
  if (finalPrice === 0) return { settled: true, price: null }
  if (auction.reserve_not_met) {
    const highBid = Number(auction.current_bid)
    return { settled: true, price: highBid > 0 ? highBid : null }
  }
  return { settled: false, price: null }
}

// Who wins the bonus prize, and how much each winner gets.
export function decideBonus({ auction, predictions, budget }) {
  const prize = bonusPrize(budget)
  const { settled, price } = bonusResult(auction)
  const calls = (predictions || []).filter(p => p && p.predicted_price != null && Number.isFinite(Number(p.predicted_price)))
  if (!settled || price == null || calls.length === 0 || prize <= 0) {
    return { settled, price, prize, winners: [], share: 0 }
  }
  const miss = p => Math.abs(Number(p.predicted_price) - price)
  const best = Math.min(...calls.map(miss))
  const winners = calls.filter(p => miss(p) === best).map(p => p.user_id)
  return { settled, price, prize, winners, share: Math.round(prize / winners.length) }
}
