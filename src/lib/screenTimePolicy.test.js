import test from 'node:test'
import assert from 'node:assert/strict'

import {
  totalScreenTimeMs,
  limitForDay,
  appLimitForDay,
  restrictedCellSet,
  cellsFromSet,
  isRestrictedNow,
  resolveLockState,
  formatMinutes,
} from './screenTimePolicy.js'

// Wednesday 2026-01-07 15:30 local
const WED = new Date(2026, 0, 7, 15, 30)
assert.equal(WED.getDay(), 3)

test('totalScreenTimeMs excludes launcher/system UI/VOICE itself', () => {
  const total = totalScreenTimeMs({
    'com.instagram.android': 60_000,
    'com.android.launcher3': 999_999,
    'com.android.systemui': 999_999,
    'com.surabhikunj.voice': 999_999,
    'com.google.android.youtube': 30_000,
    junk: 'not a number',
  })
  assert.equal(total, 90_000)
})

test('limitForDay prefers the per-weekday override and falls back to daily_limit_min', () => {
  const rule = { daily_limit_min: 120, daily_limits_by_dow: { 3: 45, 6: 0 } }
  assert.equal(limitForDay(rule, 3), 45)
  assert.equal(limitForDay(rule, 6), 0) // 0 is a real "no screen time" limit
  assert.equal(limitForDay(rule, 1), 120)
})

test('limitForDay returns null for a disabled or missing rule', () => {
  assert.equal(limitForDay(null, 3), null)
  assert.equal(limitForDay({ daily_limit_min: 60, is_enabled: false }, 3), null)
  assert.equal(limitForDay({ daily_limit_min: -5 }, 3), null)
})

test('appLimitForDay treats a 0/negative base limit as "no limit" (matches policy.js invalid_limit)', () => {
  assert.equal(appLimitForDay({ daily_limit_min: 0 }, 3), null)
  assert.equal(appLimitForDay({ daily_limit_min: 30 }, 3), 30)
  assert.equal(appLimitForDay({ daily_limit_min: 30, daily_limits_by_dow: { 3: 0 } }, 3), 0)
})

test('restrictedCellSet tolerates junk and round-trips through cellsFromSet', () => {
  const set = restrictedCellSet({ 0: [22, 23, 0, 99, 'x'], 7: [1], 3: 'nope', 5: [8, 9] })
  assert.deepEqual([...set].sort(), ['0:0', '0:22', '0:23', '5:8', '5:9'])
  assert.deepEqual(cellsFromSet(set), { 0: [0, 22, 23], 5: [8, 9] })
})

test('isRestrictedNow matches the current weekday + hour cell only', () => {
  const restricted = { cells: { 3: [15] } }
  assert.equal(isRestrictedNow(restricted, WED), true)
  assert.equal(isRestrictedNow(restricted, new Date(2026, 0, 7, 16, 0)), false)
  assert.equal(isRestrictedNow({ ...restricted, is_enabled: false }, WED), false)
  assert.equal(isRestrictedNow(null, WED), false)
})

test('resolveLockState: bonus time overrides everything', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 10 },
    restricted: { cells: { 3: [15] } },
    usageByPackage: { 'com.a': 60 * 60_000 },
    bonusActive: true,
    now: WED,
  })
  assert.equal(state.locked, false)
  assert.equal(state.reason, null)
})

test('resolveLockState: restricted time beats the daily limit and carries its action', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 10 },
    restricted: { cells: { 3: [15] }, action: 'lock_device' },
    usageByPackage: { 'com.a': 60 * 60_000 },
    now: WED,
  })
  assert.equal(state.locked, true)
  assert.equal(state.reason, 'restricted_time')
  assert.equal(state.action, 'lock_device')
})

test('resolveLockState: block_internet restricted time is reported but is not a device lock', () => {
  const state = resolveLockState({ restricted: { cells: { 3: [15] }, action: 'block_internet' }, now: WED })
  assert.equal(state.locked, false)
  assert.equal(state.reason, 'restricted_time')
  assert.equal(state.action, 'block_internet')
})

test('resolveLockState: daily limit reached locks with the configured action', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 60, limit_action: 'lock_device' },
    usageByPackage: { 'com.a': 61 * 60_000 },
    now: WED,
  })
  assert.equal(state.locked, true)
  assert.equal(state.reason, 'daily_limit')
  assert.equal(state.action, 'lock_device')
  assert.equal(state.usedMin, 61)
  assert.equal(state.limitMin, 60)
  assert.equal(state.remainingMin, 0)
})

test('resolveLockState: alert_only never locks', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 60, limit_action: 'alert_only' },
    usageByPackage: { 'com.a': 61 * 60_000 },
    now: WED,
  })
  assert.equal(state.locked, false)
  assert.equal(state.reason, 'daily_limit')
})

test('resolveLockState: without Usage Access the limit is inert (fails open, never locks out)', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 60 },
    usageByPackage: {},
    usageAvailable: false,
    now: WED,
  })
  assert.equal(state.locked, false)
})

test('resolveLockState: under the limit reports remaining minutes', () => {
  const state = resolveLockState({
    rule: { daily_limit_min: 120 },
    usageByPackage: { 'com.a': 45 * 60_000 },
    now: WED,
  })
  assert.equal(state.locked, false)
  assert.equal(state.remainingMin, 75)
})

test('resolveLockState: an active block_all schedule is a lock with reason schedule', () => {
  const state = resolveLockState({ activeSchedule: { action: 'block_all' }, now: WED })
  assert.equal(state.locked, true)
  assert.equal(state.reason, 'schedule')
})

test('formatMinutes', () => {
  assert.equal(formatMinutes(0), '0m')
  assert.equal(formatMinutes(45), '45m')
  assert.equal(formatMinutes(125), '2h 05m')
})
