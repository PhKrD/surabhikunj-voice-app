import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isMigrationApplied,
  derivePolicySyncState,
  diagnosticChecklist,
  enforcementErrorLabel,
} from './policySync.js'

const NOW = Date.parse('2026-01-01T12:00:00Z')
const recent = new Date(NOW - 30_000).toISOString() // 30s ago — online
const stale = new Date(NOW - 10 * 60_000).toISOString() // 10 min ago — offline

test('isMigrationApplied is false for a pre-migration device row', () => {
  assert.equal(isMigrationApplied({ id: 'd1', last_seen_at: recent }), false)
})

test('isMigrationApplied is true once the column is present, even if null', () => {
  assert.equal(isMigrationApplied({ id: 'd1', applied_policy_version: null }), true)
})

test('sync state is "unknown" before migration 61 is applied — never claims false confidence', () => {
  const device = { last_seen_at: recent }
  assert.equal(derivePolicySyncState(device, { policy_version: 3 }, NOW), 'unknown')
})

test('sync state is "never" for a device that has not reported any applied version', () => {
  const device = { applied_policy_version: null, last_seen_at: recent }
  assert.equal(derivePolicySyncState(device, { policy_version: 1 }, NOW), 'never')
})

test('sync state is "in_sync" when applied matches current', () => {
  const device = { applied_policy_version: 5, last_seen_at: recent }
  assert.equal(derivePolicySyncState(device, { policy_version: 5 }, NOW), 'in_sync')
})

test('sync state is "syncing" when the device is online but behind', () => {
  const device = { applied_policy_version: 4, last_seen_at: recent }
  assert.equal(derivePolicySyncState(device, { policy_version: 5 }, NOW), 'syncing')
})

test('sync state is "offline" when last_seen_at is stale, even if versions match', () => {
  // This is the important case: a stale device's "in sync" claim cannot be
  // trusted, because it may have missed a rule change since going offline.
  const device = { applied_policy_version: 5, last_seen_at: stale }
  assert.equal(derivePolicySyncState(device, { policy_version: 5 }, NOW), 'offline')
})

test('sync state is "error" when the device reports a last_error', () => {
  const device = {
    applied_policy_version: 5,
    last_seen_at: recent,
    enforcement_state: { last_error: 'not_device_admin' },
  }
  assert.equal(derivePolicySyncState(device, { policy_version: 5 }, NOW), 'error')
})

test('a device with no heartbeat at all is treated as offline, not a crash', () => {
  const device = { applied_policy_version: 1, last_seen_at: null }
  assert.equal(derivePolicySyncState(device, { policy_version: 1 }, NOW), 'offline')
})

test('enforcementErrorLabel returns a friendly message for known codes and a fallback otherwise', () => {
  assert.match(enforcementErrorLabel('not_device_admin'), /Device Admin/)
  assert.equal(enforcementErrorLabel(null), null)
  assert.match(enforcementErrorLabel('mystery_code'), /mystery_code/)
})

test('diagnosticChecklist flags a missing Device Admin permission (required)', () => {
  const device = {
    applied_policy_version: 2,
    last_seen_at: recent,
    enforcement_state: { device_admin: false, accessibility_enabled: true, usage_access: true },
  }
  const checklist = diagnosticChecklist(device, { policy_version: 2 }, NOW)
  const adminRow = checklist.find((r) => r.key === 'device_admin')
  assert.equal(adminRow.ok, false)
})

test('diagnosticChecklist flags missing Accessibility (required for app blocking / web monitoring)', () => {
  const device = {
    applied_policy_version: 2,
    last_seen_at: recent,
    enforcement_state: { device_admin: true, accessibility_enabled: false, usage_access: true },
  }
  const checklist = diagnosticChecklist(device, { policy_version: 2 }, NOW)
  const a11yRow = checklist.find((r) => r.key === 'accessibility_enabled')
  assert.equal(a11yRow.ok, false)
})

test('diagnosticChecklist never fails on a missing Device Owner — it is an optional Advanced mode', () => {
  const device = {
    applied_policy_version: 2,
    last_seen_at: recent,
    enforcement_state: { device_admin: true, accessibility_enabled: true, device_owner: false, usage_access: true },
  }
  const checklist = diagnosticChecklist(device, { policy_version: 2 }, NOW)
  const ownerRow = checklist.find((r) => r.key === 'device_owner')
  assert.equal(ownerRow.ok, true)
  assert.match(ownerRow.label, /Standard mode/)
})

test('diagnosticChecklist reports policy_sync as unavailable pre-migration instead of guessing', () => {
  const device = { last_seen_at: recent }
  const checklist = diagnosticChecklist(device, { policy_version: 2 }, NOW)
  const syncRow = checklist.find((r) => r.key === 'policy_sync')
  assert.equal(syncRow.ok, null)
  assert.match(syncRow.label, /migration pending/)
})

test('diagnosticChecklist is all-green for a healthy, in-sync device', () => {
  const device = {
    applied_policy_version: 3,
    last_seen_at: recent,
    enforcement_state: { device_admin: true, accessibility_enabled: true, usage_access: true, last_error: null },
  }
  const checklist = diagnosticChecklist(device, { policy_version: 3 }, NOW)
  for (const row of checklist) assert.notEqual(row.ok, false, `${row.key} should be ok`)
})
