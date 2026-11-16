/**
 * A garage's percentage gain: the dollars it has made as a share of the dollars
 * spent drafting it. The Ranks screen shows this as "% GAIN" and sorts its
 * "% GAIN" tab by it.
 *
 * It is one figure for the whole garage, not the cars' individual percentages
 * added up: a $2,000 car that triples and a $80,000 car that stands still make
 * a garage that is up about 5%, not 200%.
 *
 * dollarGain is the garage's net gain (NET on the Ranks screen), so it carries
 * the bonus car prize when the player has won it. A garage with nothing spent
 * has no percentage gain and reads 0.
 */
export function garagePercentGain(dollarGain, totalSpent) {
  const spent = Number(totalSpent) || 0
  if (spent <= 0) return 0
  return ((Number(dollarGain) || 0) / spent) * 100
}
