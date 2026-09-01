import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveCommandState,
  isDeviceOnline,
  isTerminalState,
  COMMAND_TIMEOUT_MS,
  DEVICE_ONLINE_WINDOW_MS,
} from './commandStatus.js'

const NOW = Date.parse('2025-06-15T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

test('unknown when there is no command', () => {
  assert.equal(deriveCommandState(null, NOW), 'unknown')
  assert.equal(deriveCommandState({}, NOW), 'unknown')
})

test('terminal statuses pass straight through', () => {
  assert.equal(deriveCommandState({ status: 'executed' }, NOW), 'executed')
  assert.equal(deriveCommandState({ status: 'failed' }, NOW), 'failed')
  assert.equal(deriveCommandState({ status: 'cancelled' }, NOW), 'cancelled')
})

test('pending within the window stays pending', () => {
  const cmd = { status: 'pending', created_at: iso(NOW - 10_000), expires_at: iso(NOW + 80_000) }
  assert.equal(deriveCommandState(cmd, NOW), 'pending')
})

test('delivered within the window shows as sent', () => {
  const cmd = { status: 'delivered', created_at: iso(NOW - 10_000), expires_at: iso(NOW + 80_000) }
  assert.equal(deriveCommandState(cmd, NOW), 'sent')
})

test('non-terminal past expires_at is timed_out', () => {
  const cmd = { status: 'delivered', created_at: iso(NOW - 120_000), expires_at: iso(NOW - 1) }
  assert.equal(deriveCommandState(cmd, NOW), 'timed_out')
})

test('falls back to created_at + default window when expires_at is null', () => {
  const fresh = { status: 'pending', created_at: iso(NOW - 1_000), expires_at: null }
  assert.equal(deriveCommandState(fresh, NOW), 'pending')

  const stale = { status: 'pending', created_at: iso(NOW - COMMAND_TIMEOUT_MS - 1_000), expires_at: null }
  assert.equal(deriveCommandState(stale, NOW), 'timed_out')
})

test('isTerminalState', () => {
  for (const s of ['executed', 'failed', 'cancelled', 'timed_out']) assert.equal(isTerminalState(s), true)
  for (const s of ['pending', 'sent', 'unknown']) assert.equal(isTerminalState(s), false)
})

test('device online detection', () => {
  assert.equal(isDeviceOnline({ last_seen_at: iso(NOW - 30_000) }, NOW), true)
  assert.equal(isDeviceOnline({ last_seen_at: iso(NOW - DEVICE_ONLINE_WINDOW_MS - 1) }, NOW), false)
  assert.equal(isDeviceOnline({ last_seen_at: null }, NOW), false)
  assert.equal(isDeviceOnline({}, NOW), false)
  assert.equal(isDeviceOnline({ last_seen_at: 'not-a-date' }, NOW), false)
})
