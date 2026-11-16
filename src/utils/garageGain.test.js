import { garagePercentGain } from './garageGain'

test('a garage bought for $82,300 and worth $213,500 is up about 159%', () => {
  expect(garagePercentGain(213500 - 82300, 82300)).toBeCloseTo(159.42, 2)
})

test("the gain is weighted by what each car cost, not the cars' percentages added up", () => {
  const cars = [
    { paid: 2000, worth: 6000 },   // +200%
    { paid: 80000, worth: 80000 }, // flat
  ]
  const spent = cars.reduce((sum, car) => sum + car.paid, 0)
  const gain = cars.reduce((sum, car) => sum + car.worth - car.paid, 0)
  expect(garagePercentGain(gain, spent)).toBeCloseTo(4.88, 2)
})

test('a garage worth less than it cost has a negative gain', () => {
  expect(garagePercentGain(-20000, 80000)).toBe(-25)
})

test('a garage worth exactly what it cost is at 0%', () => {
  expect(garagePercentGain(0, 80000)).toBe(0)
})

test('nothing spent means no percentage gain, even with a bonus prize in the bank', () => {
  expect(garagePercentGain(0, 0)).toBe(0)
  expect(garagePercentGain(10000, 0)).toBe(0)
  expect(garagePercentGain(10000, undefined)).toBe(0)
})

test('a bonus prize counted in the net gain lifts the percentage', () => {
  expect(garagePercentGain(40000 + 10000, 100000)).toBe(50)
})

test('missing or non-numeric amounts read as 0 rather than NaN', () => {
  expect(garagePercentGain(undefined, 80000)).toBe(0)
  expect(garagePercentGain('20000', '80000')).toBe(25)
})
