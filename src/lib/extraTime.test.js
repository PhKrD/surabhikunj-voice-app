import test from 'node:test'
import assert from 'node:assert/strict'

import { extendedExpiry } from './extraTime.js'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

test('extra time with nothing running starts now', () => {
  assert.equal(extendedExpiry(null, 15, NOW), new Date(NOW + 15 * 60_000).toISOString())
})

test('extra time adds to time still running instead of replacing it', () => {
  const running = new Date(NOW + 10 * 60_000).toISOString()
  assert.equal(extendedExpiry(running, 15, NOW), new Date(NOW + 25 * 60_000).toISOString())
})

test('an already-expired grant is ignored', () => {
  const expired = new Date(NOW - 60_000).toISOString()
  assert.equal(extendedExpiry(expired, 30, NOW), new Date(NOW + 30 * 60_000).toISOString())
})

test('garbage expiry is treated as nothing running', () => {
  assert.equal(extendedExpiry('not a date', 5, NOW), new Date(NOW + 5 * 60_000).toISOString())
})
