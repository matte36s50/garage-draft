import { callRange, dayLabel, hammerPoints, hammerVerdict, nyDay, shiftDay } from './hammer'

describe('hammerPoints', () => {
  it('scores 100 for a perfect call, 2 points off per 1% of error, nothing past 50%', () => {
    expect(hammerPoints(100000, 100000)).toBe(100)
    expect(hammerPoints(90000, 100000)).toBe(80)
    expect(hammerPoints(110000, 100000)).toBe(80)
    expect(hammerPoints(125000, 100000)).toBe(50)
    expect(hammerPoints(150000, 100000)).toBe(0)
    expect(hammerPoints(400000, 100000)).toBe(0)
  })

  it('matches the database on the cases it was tested with', () => {
    // hammer_points(43000, 45000) = 91 in the live test of the migration
    expect(hammerPoints(43000, 45000)).toBe(91)
  })

  it('has no score without a call or a result', () => {
    expect(hammerPoints(null, 100000)).toBeNull()
    expect(hammerPoints(100000, null)).toBeNull()
    expect(hammerPoints(100000, 0)).toBeNull()
    expect(hammerPoints('x', 100000)).toBeNull()
  })
})

describe('hammerVerdict', () => {
  it('names a score', () => {
    expect(hammerVerdict(100)).toBe('BULLSEYE')
    expect(hammerVerdict(93)).toBe('SHARP')
    expect(hammerVerdict(75)).toBe('CLOSE')
    expect(hammerVerdict(40)).toBe('IN THE ROOM')
    expect(hammerVerdict(3)).toBe('WIDE')
    expect(hammerVerdict(0)).toBe('MISS')
    expect(hammerVerdict(null)).toBeNull()
  })
})

describe('the round date', () => {
  it('follows the New York calendar, not the browser\'s', () => {
    // 23:30 in New York on the 18th is already the 19th in UTC.
    expect(nyDay(new Date('2026-11-19T04:30:00Z'))).toBe('2026-11-18')
    expect(nyDay(new Date('2026-11-19T05:30:00Z'))).toBe('2026-11-19')
    // Summer time: New York is UTC-4.
    expect(nyDay(new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30')
    expect(nyDay(new Date('2026-07-01T04:01:00Z'))).toBe('2026-07-01')
  })

  it('moves by days across month and year ends', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-11-18', 0)).toBe('2026-11-18')
  })

  it('labels the days around today', () => {
    expect(dayLabel('2026-11-18', '2026-11-18')).toBe('TODAY')
    expect(dayLabel('2026-11-17', '2026-11-18')).toBe('YESTERDAY')
    expect(dayLabel('2026-11-19', '2026-11-18')).toBe('TOMORROW')
    expect(dayLabel('2026-11-20', '2026-11-18')).toBe('FRI 20 NOV')
  })
})

describe('callRange', () => {
  it('runs an online lot from its bid to twice its bid, and no call goes under the bid', () => {
    const r = callRange({ currentBid: 42000 })
    expect(r.hasEstimate).toBe(false)
    expect(r.lo).toBe(42000)
    expect(r.hi).toBe(84000)
    expect(r.floor).toBe(42000)
    expect(r.def).toBe(50500)
    expect(r.def).toBeGreaterThanOrEqual(r.lo)
    expect(r.def).toBeLessThanOrEqual(r.hi)
  })

  it('runs a catalogue lot from half its low estimate to 1.5x its high estimate', () => {
    const r = callRange({ currentBid: 400000, estimateLow: 400000, estimateHigh: 500000 })
    expect(r.hasEstimate).toBe(true)
    expect(r.lo).toBe(200000)
    expect(r.hi).toBe(750000)
    expect(r.floor).toBe(1)
    expect(r.def).toBe(450000)
    expect((r.hi - r.lo) / r.step).toBeLessThanOrEqual(250)
  })

  it('copes with an eight-figure lot and with a lot that has no bid yet', () => {
    const big = callRange({ estimateLow: 6000000, estimateHigh: 8000000 })
    expect(big.step).toBe(50000)
    expect(big.def).toBe(7000000)
    const none = callRange({ currentBid: 0 })
    expect(none.hi).toBeGreaterThan(none.lo)
  })
})
