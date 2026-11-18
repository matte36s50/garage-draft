import { eventScore, scoringOf, SCORING } from './eventScore'

describe('scoringOf', () => {
  test('an event says its own rule; anything else is the older value rule', () => {
    expect(scoringOf({ scoring: 'profit' })).toBe(SCORING.PROFIT)
    expect(scoringOf({ scoring: 'value' })).toBe(SCORING.VALUE)
    expect(scoringOf({})).toBe(SCORING.VALUE)
    expect(scoringOf(null)).toBe(SCORING.VALUE)
    expect(scoringOf({ scoring: 'something-else' })).toBe(SCORING.VALUE)
  })
})

describe('eventScore', () => {
  test('value: what the garage is worth, plus the bonus prize; what was paid is ignored', () => {
    expect(eventScore({ scoring: 'value', carsValue: 900000, spent: 700000 })).toBe(900000)
    expect(eventScore({ scoring: 'value', carsValue: 900000, spent: 700000, bonus: 50000 })).toBe(950000)
  })

  test('profit: what the garage made over what it cost, plus the bonus prize', () => {
    expect(eventScore({ scoring: 'profit', carsValue: 900000, spent: 700000 })).toBe(200000)
    expect(eventScore({ scoring: 'profit', carsValue: 900000, spent: 700000, bonus: 50000 })).toBe(250000)
  })

  test('profit can finish below zero', () => {
    expect(eventScore({ scoring: 'profit', carsValue: 600000, spent: 700000 })).toBe(-100000)
  })

  test('profit: spending more does not score more by itself', () => {
    const cautious = eventScore({ scoring: 'profit', carsValue: 550000, spent: 500000 })
    const bigSpender = eventScore({ scoring: 'profit', carsValue: 9040000, spent: 9000000 })
    expect(cautious).toBeGreaterThan(bigSpender)
    // Under the value rule the same two garages finish the other way round.
    expect(eventScore({ scoring: 'value', carsValue: 9040000, spent: 9000000 }))
      .toBeGreaterThan(eventScore({ scoring: 'value', carsValue: 550000, spent: 500000 }))
  })

  test('an empty garage scores zero under either rule', () => {
    expect(eventScore({ scoring: 'value', carsValue: 0, spent: 0 })).toBe(0)
    expect(eventScore({ scoring: 'profit', carsValue: 0, spent: 0 })).toBe(0)
    expect(eventScore({ scoring: 'profit' })).toBe(0)
  })
})
