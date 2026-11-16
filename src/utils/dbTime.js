/**
 * Event times (leagues.draft_starts_at, draft_ends_at, start_date, end_date)
 * are stored without a time zone, and the server reads them as UTC: draft_car
 * compares them with NOW(). A browser reads "2026-11-20T16:00:00" as local
 * time, so the countdown was off by the player's UTC offset and a draft could
 * close hours before the app said it would.
 *
 * parseDbTime reads such a value as UTC, the same way the server does. A value
 * that already carries a zone ("...Z", "...+00:00") is left as it is, so this
 * keeps working if the columns become timestamptz.
 */
const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?$/

export function parseDbTime(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const text = String(value).trim()
  const m = text.match(NAIVE)
  if (!m) {
    const parsed = new Date(text)
    return isNaN(parsed) ? null : parsed
  }
  // Postgres keeps microseconds; a Date only takes milliseconds.
  const fraction = m[3] ? m[3].slice(0, 4) : ''
  const parsed = new Date(`${m[1]}T${m[2]}${fraction}Z`)
  return isNaN(parsed) ? null : parsed
}

/**
 * The reverse, for forms: a <input type="datetime-local"> value is the admin's
 * local time; store the instant it names, as the UTC wall-clock time the
 * server expects ("2026-11-20T16:00:00").
 */
export function localInputToDbTime(value) {
  if (!value) return null
  const parsed = new Date(value)
  return isNaN(parsed) ? null : parsed.toISOString().slice(0, 19)
}
