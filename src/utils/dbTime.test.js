import { localInputToDbTime, parseDbTime } from './dbTime'

describe('parseDbTime', () => {
  test('reads a zone-less database time as UTC, whatever the browser zone', () => {
    expect(parseDbTime('2026-11-20T16:00:00').toISOString()).toBe('2026-11-20T16:00:00.000Z')
    expect(parseDbTime('2026-11-20 16:00:00').toISOString()).toBe('2026-11-20T16:00:00.000Z')
    expect(parseDbTime('2026-11-20T16:00').toISOString()).toBe('2026-11-20T16:00:00.000Z')
  })

  test('keeps Postgres microseconds to the millisecond', () => {
    expect(parseDbTime('2026-02-12T19:46:07.921981').toISOString()).toBe('2026-02-12T19:46:07.921Z')
  })

  test('leaves values that already carry a zone alone', () => {
    expect(parseDbTime('2026-11-20T16:00:00Z').toISOString()).toBe('2026-11-20T16:00:00.000Z')
    expect(parseDbTime('2026-11-20T11:00:00-05:00').toISOString()).toBe('2026-11-20T16:00:00.000Z')
    expect(parseDbTime('2026-11-20T16:00:00+00:00').toISOString()).toBe('2026-11-20T16:00:00.000Z')
  })

  test('passes dates through and returns null for nothing or nonsense', () => {
    const d = new Date('2026-01-01T00:00:00Z')
    expect(parseDbTime(d)).toBe(d)
    expect(parseDbTime(null)).toBeNull()
    expect(parseDbTime('')).toBeNull()
    expect(parseDbTime('not a date')).toBeNull()
  })
})

describe('localInputToDbTime', () => {
  test('turns a datetime-local value into the UTC wall-clock time it names', () => {
    const local = '2026-11-20T11:00'
    const expected = new Date(local).toISOString().slice(0, 19)
    expect(localInputToDbTime(local)).toBe(expected)
    // Round trip: what the server will enforce is the instant the admin typed.
    expect(parseDbTime(localInputToDbTime(local)).getTime()).toBe(new Date(local).getTime())
  })

  test('returns null for an empty or invalid value', () => {
    expect(localInputToDbTime('')).toBeNull()
    expect(localInputToDbTime('nope')).toBeNull()
  })
})
