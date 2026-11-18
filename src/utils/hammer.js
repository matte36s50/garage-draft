/**
 * Call the hammer: the daily price-calling game.
 *
 * The database does the scoring (hammer_points() in
 * supabase_migration_call_the_hammer.sql); the rule here is the same one, so
 * the screen can show what a call earned and the tests can pin it down.
 *
 *   points = max(0, round(100 - 200 x |call - result| / result))
 *
 * A perfect call scores 100, 10% off scores 80, 25% off 50, 50% off nothing.
 */

export const HAMMER_LOTS_PER_DAY = 5

export function hammerPoints(call, result) {
  if (call == null || result == null) return null
  const c = Number(call)
  const r = Number(result)
  if (!Number.isFinite(c) || !Number.isFinite(r) || r <= 0) return null
  return Math.max(0, Math.round(100 - (200 * Math.abs(c - r)) / r))
}

/** A word for a score, for the result line under a lot. */
export function hammerVerdict(points) {
  if (points == null) return null
  if (points >= 100) return 'BULLSEYE'
  if (points >= 90) return 'SHARP'
  if (points >= 70) return 'CLOSE'
  if (points >= 40) return 'IN THE ROOM'
  if (points > 0) return 'WIDE'
  return 'MISS'
}

// Rounds run on the New York calendar, where Bring a Trailer's lots close.
const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** The round's date for a moment, as 'YYYY-MM-DD' in New York. */
export function nyDay(at = new Date()) {
  return nyDate.format(at)
}

/** 'YYYY-MM-DD' moved by n days. */
export function shiftDay(day, n) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 'TODAY', 'YESTERDAY', 'TOMORROW', else 'FRI 20 NOV'. */
export function dayLabel(day, today) {
  if (day === today) return 'TODAY'
  if (day === shiftDay(today, -1)) return 'YESTERDAY'
  if (day === shiftDay(today, 1)) return 'TOMORROW'
  const d = new Date(`${day}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '').toUpperCase()
}

/**
 * The quick-pick range for a price call, shared by the bonus car and Call the
 * hammer.
 *   Online lot (a live bid): the current bid to twice the bid. A sale can't
 *     finish under the bid already placed, so that is also the lowest call.
 *   Catalogue lot (an estimate): half the low estimate to 1.5x the high one,
 *     because lots do sell under their estimate and a call must be free to say
 *     so. Any positive call is allowed.
 * Typed amounts may go beyond either end.
 *   { lo, hi, step, def, floor, hasEstimate }
 */
export function callRange({ currentBid, estimateLow, estimateHigh }) {
  const hasEstimate = estimateLow != null
  const bid = Math.round(Number(currentBid)) || 0
  const estLow = hasEstimate ? Number(estimateLow) : null
  const estHigh = hasEstimate ? Number(estimateHigh || estimateLow) : null
  const lo = hasEstimate ? Math.round(estLow * 0.5) : bid
  const hi = hasEstimate
    ? Math.round(estHigh * 1.5)
    : Math.max(lo + 1000, Math.round((bid * 2) / 1000) * 1000)
  const step = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000]
    .find(s => s >= (hi - lo) / 250) || 500000
  const snap = v => Math.round(v / step) * step
  const def = hasEstimate
    ? snap((estLow + estHigh) / 2)
    : Math.min(hi, Math.max(lo, Math.round((bid * 1.2) / 500) * 500))
  const floor = hasEstimate ? 1 : lo
  return { lo, hi, step, def, floor, hasEstimate }
}
