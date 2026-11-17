/**
 * How an event is scored. Each event carries its rule in leagues.scoring
 * (supabase_migration_scoring.sql).
 *
 *   value    Events before November 2026. The score is what the garage is
 *            worth, plus any bonus prize. What was paid doesn't count, so
 *            unspent budget is worth nothing and spending more scores more.
 *
 *   profit   The score is what the garage made: what it is worth, plus any
 *            bonus prize, minus what was paid for it. Unspent budget neither
 *            helps nor hurts. A garage can finish below zero.
 *
 * Either way a car is worth what lib/carValue.js says, and complete
 * seven-car garages rank above incomplete ones.
 *
 * Keep in sync with src/utils/eventScore.js in the player app.
 */

export const SCORING = { VALUE: 'value', PROFIT: 'profit' };

// The rule an event uses. Anything but 'profit' is the older 'value' rule.
export function scoringOf(league) {
  return league && league.scoring === SCORING.PROFIT ? SCORING.PROFIT : SCORING.VALUE;
}

// carsValue: the garage's cars at their current worth. spent: what they cost.
// bonus: the bonus car prize this player has won, if any.
export function eventScore({ scoring, carsValue, spent, bonus = 0 }) {
  const worth = (Number(carsValue) || 0) + (Number(bonus) || 0);
  return scoring === SCORING.PROFIT ? worth - (Number(spent) || 0) : worth;
}
