/**
 * Historical FX → USD lookup for live-entry conversion.
 *
 * Rates come from frankfurter.dev (ECB daily reference rates — free, no key).
 * A date on a weekend/holiday resolves to the most recent business day, which
 * is the standard convention for sale-date conversion. Rates are cached per
 * (currency, date) for the life of the serverless instance.
 */

const cache = new Map();

export async function getUsdRate(currency, dateISO) {
  const cur = String(currency || 'USD').toUpperCase();
  if (cur === 'USD') return 1;

  const today = new Date().toISOString().slice(0, 10);
  let date = String(dateISO || '').slice(0, 10);
  // Future or missing sale date (pre-auction estimates): use the latest rate;
  // the results pass re-converts at the actual sale date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) date = 'latest';

  const key = `${cur}:${date === 'latest' ? today : date}`;
  if (cache.has(key)) return cache.get(key);

  const resp = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${cur}&symbols=USD`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`FX rate lookup failed for ${cur}${date === 'latest' ? '' : ` on ${date}`} (HTTP ${resp.status})`);
  }
  const data = await resp.json();
  const rate = data?.rates?.USD;
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new Error(`No USD rate available for ${cur}`);
  }
  cache.set(key, rate);
  return rate;
}
