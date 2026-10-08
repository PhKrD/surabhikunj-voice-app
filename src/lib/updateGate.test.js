import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGate } from './updateGate.js'

const ok = { status: 'ok', recommended: false }

test('no config (offline, migration not applied) never blocks', () => {
  assert.deepEqual(computeGate(null, 3), ok)
  assert.deepEqual(computeGate({}, 2), ok)
})

test('forced update only below the minimum build', () => {
  const p = { min_native_version_code: 3 }
  assert.equal(computeGate(p, 2).status, 'update_required')
  assert.deepEqual(computeGate(p, 3), ok)
  assert.deepEqual(computeGate(p, 4), ok)
})

test('recommended update shows until dismissed for that build', () => {
  const p = { recommended_native_version_code: 4 }
  assert.equal(computeGate(p, 3).recommended, true)
  assert.equal(computeGate(p, 3, { dismissedFor: 4 }).recommended, false)
  // A newer recommendation reappears after dismissing an older one.
  assert.equal(computeGate({ recommended_native_version_code: 5 }, 3, { dismissedFor: 4 }).recommended, true)
  assert.equal(computeGate(p, 4).recommended, false)
})

test('maintenance blocks everyone except platform admins', () => {
  const p = { maintenance_enabled: true, min_native_version_code: 9 }
  assert.equal(computeGate(p, 3).status, 'maintenance')
  assert.equal(computeGate(p, null).status, 'maintenance')
  // Admins pass maintenance (still subject to version gating).
  assert.equal(computeGate(p, 3, { isPlatformAdmin: true }).status, 'update_required')
  assert.deepEqual(computeGate({ maintenance_enabled: true }, 3, { isPlatformAdmin: true }), ok)
})

test('the web build is never version-gated', () => {
  assert.deepEqual(computeGate({ min_native_version_code: 99, recommended_native_version_code: 99 }, null), ok)
})
