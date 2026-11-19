import { SCORING } from './eventScore.js';

/**
 * What a drafted car is worth to its owner's score right now. The hourly score
 * cron uses this, so History records the same value the player app shows.
 *
 *   sold            final_price > 0              the hammer price
 *   withdrawn       final_price = 0              what was paid for it, in a
 *                                                profit event (it scores zero,
 *                                                as if never bought); $0 in an
 *                                                older value event
 *   no sale         reserve_not_met              25% of the high bid
 *   result pending  ended, no result recorded    the high bid, until the
 *                                                result is recorded
 *   live            still running                the current bid
 *
 * Keep in sync with src/utils/carValue.js, which the player app screens use.
 */

export const NO_SALE_SHARE = 0.25;

// scoring: the event's rule (utils/eventScore.js). It only changes a withdrawn car.
export function carValue({ finalPrice, reserveNotMet, ended, currentBid, purchasePrice, scoring }) {
  const bid = Number(currentBid) || Number(purchasePrice) || 0;
  const final = finalPrice == null ? null : Number(finalPrice);
  if (final > 0) return { status: 'sold', value: final };
  // A lot pulled before it sells says nothing about the player's pick. Under
  // profit it counts at its price, so it neither gains nor loses. Older value
  // events keep $0, so their finished standings don't move.
  if (final === 0) return { status: 'withdrawn', value: scoring === SCORING.PROFIT ? Number(purchasePrice) || 0 : 0 };
  if (reserveNotMet) return { status: 'no_sale', value: bid * NO_SALE_SHARE };
  if (ended) return { status: 'pending', value: bid };
  return { status: 'live', value: bid };
}
