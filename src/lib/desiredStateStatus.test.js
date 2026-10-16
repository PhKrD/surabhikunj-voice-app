import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceControlStatus, controlStatus, controlStatusLabel } from './desiredStateStatus.js'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const online = new Date(NOW - 30_000).toISOString()
const offline = new Date(NOW - 60 * 60_000).toISOString()

const dev = (id, state, seen = online, extra = {}) => ({ id, is_active: true, last_seen_at: seen, enforcement_state: state, ...extra })

test('lock is applied once the phone reports a parent lock', () => {
  const child = { parent_lock_active: true }
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: 'parent_lock' }), NOW), 'applied')
})

test('an online phone that has not reported the lock yet is applying', () => {
  const child = { parent_lock_active: true }
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: null }), NOW), 'applying')
})

test('an offline phone is waiting, not failed', () => {
  const child = { parent_lock_active: true }
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: null }, offline), NOW), 'waiting')
})

test('a schedule lock does not count as the parent lock', () => {
  const child = { parent_lock_active: false }
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: 'schedule' }), NOW), 'applied')
  assert.equal(deviceControlStatus('lock', { parent_lock_active: true }, dev('a', { lock_reason: 'schedule' }), NOW), 'applying')
})

test('unlock is applied once the phone stops reporting a parent lock', () => {
  const child = { parent_lock_active: false }
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: 'parent_lock' }), NOW), 'applying')
  assert.equal(deviceControlStatus('lock', child, dev('a', { lock_reason: null }), NOW), 'applied')
})

test('internet pause reads manual_internet_pause, not internet_paused', () => {
  // internet_paused is true under ANY lock; only manual_internet_pause is the parent's pause.
  const child = { internet_pause_active: false }
  assert.equal(deviceControlStatus('pause', child, dev('a', { internet_paused: true, manual_internet_pause: false }), NOW), 'applied')
  assert.equal(deviceControlStatus('pause', { internet_pause_active: true }, dev('a', { manual_internet_pause: true }), NOW), 'applied')
})

test('no report yet is unknown', () => {
  assert.equal(deviceControlStatus('lock', { parent_lock_active: true }, dev('a', null), NOW), 'unknown')
})

test('summary is the worst device: one offline phone keeps it waiting', () => {
  const child = { parent_lock_active: true }
  const devices = [dev('a', { lock_reason: 'parent_lock' }), dev('b', { lock_reason: null }, offline)]
  assert.equal(controlStatus('lock', child, devices, NOW).status, 'waiting')
})

test('inactive devices are ignored', () => {
  const child = { parent_lock_active: true }
  const devices = [dev('a', { lock_reason: 'parent_lock' }), dev('b', { lock_reason: null }, offline, { is_active: false })]
  const r = controlStatus('lock', child, devices, NOW)
  assert.equal(r.status, 'applied')
  assert.equal(r.devices.length, 1)
})

test('labels', () => {
  assert.equal(controlStatusLabel('lock', true, 'applied'), 'Locked on the phone')
  assert.equal(controlStatusLabel('pause', false, 'applied'), 'Back online on the phone')
  assert.match(controlStatusLabel('lock', true, 'waiting'), /offline/)
})
