import test from 'node:test'
import assert from 'node:assert/strict'

import { protectionHealth, oemGuidance, onlineStatus, REPORT_STALE_MS } from './protectionHealth.js'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const iso = (ms) => new Date(ms).toISOString()

const healthy = {
  accessibility_enabled: true,
  usage_access: true,
  device_admin: true,
  battery_optimization_exempt: true,
  location_permission: 'always',
  notifications_allowed: true,
  overlay_granted: true,
}
const device = (state, ageMs = 60_000) => ({ enforcement_state: state, last_enforcement_at: iso(NOW - ageMs) })

test('fully set up phone with a PIN is Strong at 100%', () => {
  const h = protectionHealth(device(healthy), { parent_pin_hash: 'x' }, { now: NOW })
  assert.equal(h.status, 'strong')
  assert.equal(h.score, 100)
  assert.equal(h.missing.length, 0)
})

test('Accessibility off is Critical no matter what else is on', () => {
  const h = protectionHealth(device({ ...healthy, accessibility_enabled: false }), { parent_pin_hash: 'x' }, { now: NOW })
  assert.equal(h.status, 'critical')
  assert.match(h.headline, /Accessibility/)
})

test('a missing battery exemption and no PIN needs attention, with fixes listed', () => {
  const h = protectionHealth(device({ ...healthy, battery_optimization_exempt: false }), { parent_pin_hash: null }, { now: NOW })
  assert.equal(h.status, 'attention')
  assert.deepEqual(h.missing.map((i) => i.key).sort(), ['battery_optimization_exempt', 'settings_protected'])
  assert.ok(h.missing.every((i) => i.fix.length > 0 && i.stops))
})

test('location while-in-use counts as partial, not full', () => {
  const h = protectionHealth(device({ ...healthy, location_permission: 'while_in_use' }), { parent_pin_hash: 'x' }, { now: NOW })
  assert.equal(h.items.find((i) => i.key === 'location_permission').state, 'partial')
  assert.ok(h.score < 100 && h.score > 90)
})

test('NEVER green from stale data: an old report is "unknown" with no score', () => {
  const h = protectionHealth(device(healthy, REPORT_STALE_MS + 1), { parent_pin_hash: 'x' }, { now: NOW })
  assert.equal(h.status, 'unknown')
  assert.equal(h.score, null)
  assert.ok(h.items.filter((i) => i.key !== 'settings_protected').every((i) => i.state === 'unknown'))
})

test('a phone that never reported is "not set up"', () => {
  const h = protectionHealth({ enforcement_state: null, last_enforcement_at: null }, null, { now: NOW })
  assert.equal(h.status, 'inactive')
})

test('unreported fields are unknown, never assumed on', () => {
  const h = protectionHealth(device({ accessibility_enabled: true }), null, { now: NOW })
  assert.equal(h.items.find((i) => i.key === 'usage_access').state, 'unknown')
})

test('web protection only counts when the parent relies on it', () => {
  const off = protectionHealth(device({ ...healthy, vpn_consent: false }), { parent_pin_hash: 'x' }, { now: NOW })
  assert.equal(off.score, 100)
  const on = protectionHealth(device({ ...healthy, vpn_consent: false }), { parent_pin_hash: 'x' }, { now: NOW, vpnRequired: true })
  assert.ok(on.missing.some((i) => i.key === 'vpn_consent'))
})

test('OEM guidance matches common aggressive manufacturers, none for unknown', () => {
  assert.equal(oemGuidance('Xiaomi').brand, 'Xiaomi / Redmi / POCO')
  assert.equal(oemGuidance('POCO').brand, 'Xiaomi / Redmi / POCO')
  assert.equal(oemGuidance('vivo').brand, 'Vivo / iQOO')
  assert.equal(oemGuidance('realme').brand, 'Realme')
  assert.equal(oemGuidance('OnePlus').brand, 'OnePlus')
  assert.equal(oemGuidance('samsung').brand, 'Samsung')
  assert.equal(oemGuidance('Google'), null)
  assert.equal(oemGuidance(undefined), null)
})

test('online status wording and tone', () => {
  assert.equal(onlineStatus({ last_seen_at: iso(NOW - 60_000) }, NOW).label, 'Online now')
  assert.equal(onlineStatus({ last_seen_at: iso(NOW - 8 * 60_000) }, NOW).label, 'Last seen 8 min ago')
  assert.equal(onlineStatus({ last_seen_at: iso(NOW - 3 * 3_600_000) }, NOW).label, 'Offline for 3 h')
  assert.equal(onlineStatus({ last_seen_at: iso(NOW - 4 * 86_400_000) }, NOW).label, 'Offline for 4 days')
  assert.equal(onlineStatus({}, NOW).label, 'Never connected')
})
