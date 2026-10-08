import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDateISO, shiftDateISO } from './dates.js'

test('localDateISO uses local calendar fields, not UTC', () => {
  // 00:30 local on 8 Oct — in IST the UTC date is still 7 Oct.
  const d = new Date(2026, 9, 8, 0, 30)
  assert.equal(localDateISO(d), '2026-10-08')
})

test('shiftDateISO moves across month and year ends', () => {
  assert.equal(shiftDateISO('2026-10-08', 1), '2026-10-09')
  assert.equal(shiftDateISO('2026-10-08', -1), '2026-10-07')
  assert.equal(shiftDateISO('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDateISO('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDateISO('2028-03-01', -1), '2028-02-29')
})
