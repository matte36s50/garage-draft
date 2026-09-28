/**
 * When a finished event can be closed and written to History.
 *
 * An event closes once its draft is over and every drafted car's auction, plus
 * the bonus auction, has ended with a recorded result: sold, no sale or
 * withdrawn. Results come from the hourly finalizer, which retries a lot for
 * 12 hours before an admin has to record it by hand, so an event waits up to
 * RESULT_GRACE_HOURS after its last auction ends for a missing result. After
 * that it closes anyway: a car still without a result counts at its high bid,
 * and an unsettled bonus auction pays nothing.
 */

export const RESULT_GRACE_HOURS = Number(process.env.RESULT_GRACE_HOURS || 48);

const hasResult = lot => lot.final_price != null || lot.reserve_not_met === true;

// lots: auctions rows ({ final_price, reserve_not_met, timestamp_end }) for every
// drafted car. Returns { ready, reason, missing }.
export function eventCompletion({ draftEndsAt, cars, bonusAuction = null, now = Date.now(), graceHours = RESULT_GRACE_HOURS }) {
  const nowSec = now / 1000;
  const draftEnd = draftEndsAt ? new Date(draftEndsAt).getTime() / 1000 : NaN;
  if (!(draftEnd <= nowSec)) return { ready: false, reason: 'draft_open', missing: 0 };
  if (!cars || cars.length === 0) return { ready: false, reason: 'no_cars', missing: 0 };

  const lots = bonusAuction ? [...cars, bonusAuction] : cars;
  // A lot with no end time can't be waited on, so it counts as ending with the draft.
  const endOf = lot => Number(lot.timestamp_end) || draftEnd;
  const missing = lots.filter(lot => !hasResult(lot));

  if (missing.some(lot => endOf(lot) > nowSec)) {
    return { ready: false, reason: 'auctions_running', missing: missing.length };
  }
  if (missing.length === 0) return { ready: true, reason: 'results_in', missing: 0 };

  const waitedSec = nowSec - Math.max(...missing.map(endOf));
  if (waitedSec >= graceHours * 3600) {
    return { ready: true, reason: 'grace_expired', missing: missing.length };
  }
  return { ready: false, reason: 'awaiting_results', missing: missing.length };
}
