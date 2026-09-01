import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PROTECTED_PACKAGES,
  isProtectedPackage,
  parseHm,
  isTimeInRange,
  isScheduleActive,
  findActiveSchedule,
  resolvePolicy,
  diffSuspension,
  policySignature,
  usageMapFromApps,
} from './policy.js'

// Local date at a fixed wall-clock time, independent of the host timezone.
function at(hh, mm, dayOffset = 0) {
  const d = new Date(2026, 0, 5 + dayOffset) // 2026-01-05 is a Monday
  d.setHours(hh, mm, 0, 0)
  return d
}

const rule = (over = {}) => ({
  id: over.id ?? 'r1',
  package_name: 'com.example.app',
  action: 'block',
  is_enabled: true,
  daily_limit_min: null,
  ...over,
})

// ── time parsing ─────────────────────────────────────────────────────

test('parseHm accepts HH:MM and HH:MM:SS, rejects junk', () => {
  assert.equal(parseHm('08:00'), 480)
  assert.equal(parseHm('22:30:00'), 1350)
  assert.equal(parseHm('00:00'), 0)
  assert.equal(parseHm('24:00'), null)
  assert.equal(parseHm('7:5'), null)
  assert.equal(parseHm(''), null)
  assert.equal(parseHm(null), null)
})

test('isTimeInRange treats the end bound as exclusive', () => {
  assert.equal(isTimeInRange('08:00', '14:00', 480), true) // exactly start
  assert.equal(isTimeInRange('08:00', '14:00', 839), true)
  assert.equal(isTimeInRange('08:00', '14:00', 840), false) // exactly end
  assert.equal(isTimeInRange('08:00', '14:00', 479), false)
})

test('isTimeInRange handles windows crossing midnight', () => {
  // bedtime 22:00 → 06:30
  assert.equal(isTimeInRange('22:00', '06:30', 1330), true) // 22:10
  assert.equal(isTimeInRange('22:00', '06:30', 60), true) // 01:00
  assert.equal(isTimeInRange('22:00', '06:30', 389), true) // 06:29
  assert.equal(isTimeInRange('22:00', '06:30', 390), false) // 06:30 exactly
  assert.equal(isTimeInRange('22:00', '06:30', 720), false) // noon
})

test('a zero-length window is never active', () => {
  assert.equal(isTimeInRange('09:00', '09:00', 540), false)
})

// ── schedules ────────────────────────────────────────────────────────

const schoolSchedule = {
  id: 's-school',
  name: 'School',
  is_enabled: true,
  days_of_week: [1, 2, 3, 4, 5],
  start_time: '08:00',
  end_time: '14:00',
  action: 'block_all',
}

test('isScheduleActive respects day-of-week', () => {
  assert.equal(isScheduleActive(schoolSchedule, at(10, 0)), true) // Monday
  assert.equal(isScheduleActive(schoolSchedule, at(10, 0, 5)), false) // Saturday
})

test('a disabled schedule never activates', () => {
  assert.equal(isScheduleActive({ ...schoolSchedule, is_enabled: false }, at(10, 0)), false)
})

test('findActiveSchedule picks the most restrictive overlapping window', () => {
  const internetOnly = {
    id: 's-a-internet',
    is_enabled: true,
    days_of_week: [1],
    start_time: '08:00',
    end_time: '18:00',
    action: 'block_internet',
  }
  // 's-a-internet' sorts first alphabetically — severity must still win.
  const active = findActiveSchedule([internetOnly, schoolSchedule], at(10, 0))
  assert.equal(active.id, 's-school')
  assert.equal(active.action, 'block_all')
})

test('parent-granted bonus time suspends all schedules', () => {
  const active = findActiveSchedule([schoolSchedule], at(10, 0), { bonusActive: true })
  assert.equal(active, null)
})

// ── policy resolution ────────────────────────────────────────────────

test('block rules produce a sorted, deduplicated block list', () => {
  const res = resolvePolicy({
    rules: [
      rule({ id: 'b', package_name: 'com.zeta.app' }),
      rule({ id: 'a', package_name: 'com.alpha.app' }),
      rule({ id: 'c', package_name: 'com.alpha.app' }), // duplicate
    ],
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, ['com.alpha.app', 'com.zeta.app'])
})

test('disabled rules are ignored', () => {
  const res = resolvePolicy({
    rules: [rule({ package_name: 'com.example.app', is_enabled: false })],
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, [])
})

test('protected packages can never be blocked, even if a rule exists', () => {
  for (const pkg of ['com.android.server.telecom', 'com.surabhikunj.voice', 'com.android.settings']) {
    const res = resolvePolicy({ rules: [rule({ package_name: pkg })], now: at(12, 0) })
    assert.deepEqual(res.blockList, [], `${pkg} must not be blockable`)
    assert.equal(res.skipped[0].reason, 'protected_package')
  }
})

test('a protected package cannot be time-limited either', () => {
  const res = resolvePolicy({
    rules: [rule({ package_name: 'com.android.dialer', action: 'time_limit', daily_limit_min: 1 })],
    usageByPackage: { 'com.android.dialer': 60 * 60_000 },
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, [])
})

test('every declared protected package is recognised', () => {
  for (const pkg of PROTECTED_PACKAGES) assert.equal(isProtectedPackage(pkg), true)
  assert.equal(isProtectedPackage('com.android.chrome'), false)
})

test('time_limit blocks only once usage reaches the limit', () => {
  const rules = [rule({ package_name: 'com.android.chrome', action: 'time_limit', daily_limit_min: 30 })]

  const under = resolvePolicy({ rules, usageByPackage: { 'com.android.chrome': 29 * 60_000 }, now: at(12, 0) })
  assert.deepEqual(under.blockList, [])
  assert.deepEqual(under.limitStatus, [
    { packageName: 'com.android.chrome', usedMin: 29, limitMin: 30, exceeded: false },
  ])

  const atLimit = resolvePolicy({ rules, usageByPackage: { 'com.android.chrome': 30 * 60_000 }, now: at(12, 0) })
  assert.deepEqual(atLimit.blockList, ['com.android.chrome'])
})

test('time_limit is inert when Usage Access is not granted (fails open, never locks out)', () => {
  const res = resolvePolicy({
    rules: [rule({ package_name: 'com.android.chrome', action: 'time_limit', daily_limit_min: 30 })],
    usageAvailable: false,
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, [])
  assert.equal(res.skipped[0].reason, 'no_usage_access')
})

test('bonus time lifts app time limits but not hard blocks', () => {
  const res = resolvePolicy({
    rules: [
      rule({ id: 'lim', package_name: 'com.android.chrome', action: 'time_limit', daily_limit_min: 5 }),
      rule({ id: 'blk', package_name: 'com.google.android.youtube', action: 'block' }),
    ],
    usageByPackage: { 'com.android.chrome': 99 * 60_000 },
    bonusActive: true,
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, ['com.google.android.youtube'])
})

test('an explicit allow rule overrides a block on the same package', () => {
  const res = resolvePolicy({
    rules: [
      rule({ id: '1', package_name: 'com.example.app', action: 'block' }),
      rule({ id: '2', package_name: 'com.example.app', action: 'allow' }),
    ],
    now: at(12, 0),
  })
  assert.deepEqual(res.blockList, [])
  assert.deepEqual(res.allowList, ['com.example.app'])
})

test('a time_limit rule with a missing or zero limit is skipped, not treated as block', () => {
  for (const limit of [null, 0, -5, undefined, 'abc']) {
    const res = resolvePolicy({
      rules: [rule({ package_name: 'com.example.app', action: 'time_limit', daily_limit_min: limit })],
      now: at(12, 0),
    })
    assert.deepEqual(res.blockList, [], `limit=${limit}`)
  }
})

// ── reconciliation (the block/unblock correctness core) ──────────────

test('diffSuspension suspends only what is newly desired', () => {
  const d = diffSuspension(['a'], ['a', 'b'])
  assert.deepEqual(d.toSuspend, ['b'])
  assert.deepEqual(d.toUnsuspend, [])
  assert.deepEqual(d.nextApplied, ['a', 'b'])
})

test('REGRESSION: deleting the last rule releases previously blocked apps', () => {
  // This is the exact failure reported in production: the parent removed
  // every block rule and the apps stayed suspended on the device.
  const d = diffSuspension(['com.android.chrome', 'com.google.android.youtube'], [])
  assert.deepEqual(d.toSuspend, [])
  assert.deepEqual(d.toUnsuspend, ['com.android.chrome', 'com.google.android.youtube'])
  assert.deepEqual(d.nextApplied, [])
})

test('REGRESSION: a lost applied-state cache still heals via the installed list', () => {
  // App data cleared / reinstalled → applied-state is empty, but Chrome is
  // still suspended at the OS level. Without the installed-package sweep
  // the device could never recover.
  const installed = ['com.android.chrome', 'com.google.android.youtube', 'com.android.deskclock']
  const d = diffSuspension([], ['com.google.android.youtube'], installed)
  assert.deepEqual(d.toSuspend, ['com.google.android.youtube'])
  assert.deepEqual(d.toUnsuspend, ['com.android.chrome', 'com.android.deskclock'])
})

test('reconciliation never unsuspends-then-resuspends a still-blocked app', () => {
  const d = diffSuspension(['com.google.android.youtube'], ['com.google.android.youtube'], [
    'com.google.android.youtube',
    'com.android.chrome',
  ])
  assert.deepEqual(d.toSuspend, [])
  assert.deepEqual(d.toUnsuspend, ['com.android.chrome'])
})

test('reconciliation refuses to touch protected packages in either direction', () => {
  const d = diffSuspension(['com.android.server.telecom'], ['com.android.server.telecom'], [
    'com.android.server.telecom',
    'com.surabhikunj.voice',
  ])
  assert.deepEqual(d.toSuspend, [])
  assert.deepEqual(d.toUnsuspend, [])
  assert.deepEqual(d.nextApplied, [])
})

test('diffSuspension is idempotent — reapplying a settled state is a no-op', () => {
  const desired = ['com.android.chrome']
  const first = diffSuspension([], desired)
  const second = diffSuspension(first.nextApplied, desired)
  assert.deepEqual(second.toSuspend, [])
  assert.deepEqual(second.toUnsuspend, [])
})

// ── signature + helpers ──────────────────────────────────────────────

test('policySignature is stable across rule ordering but changes with content', () => {
  const a = resolvePolicy({ rules: [rule({ id: '1', package_name: 'b.app' }), rule({ id: '2', package_name: 'a.app' })], now: at(12, 0) })
  const b = resolvePolicy({ rules: [rule({ id: '2', package_name: 'a.app' }), rule({ id: '1', package_name: 'b.app' })], now: at(12, 0) })
  assert.equal(policySignature(a, 7), policySignature(b, 7))

  const c = resolvePolicy({ rules: [rule({ package_name: 'a.app' })], now: at(12, 0) })
  assert.notEqual(policySignature(a, 7), policySignature(c, 7))
})

test('policySignature changes when the server policy version advances', () => {
  const r = resolvePolicy({ rules: [rule()], now: at(12, 0) })
  assert.notEqual(policySignature(r, 1), policySignature(r, 2))
})

test('usageMapFromApps folds the native payload into a package→ms map', () => {
  const map = usageMapFromApps([
    { packageName: 'a', totalForegroundMs: 1000 },
    { packageName: 'b', totalForegroundMs: 500 },
    { packageName: 'a', totalForegroundMs: 250 },
    { totalForegroundMs: 999 }, // malformed row is ignored
  ])
  assert.deepEqual(map, { a: 1250, b: 500 })
})
