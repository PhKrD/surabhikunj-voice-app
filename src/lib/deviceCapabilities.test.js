import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectPlatform,
  capabilitiesForDevice,
  deviceSupports,
  CAPABILITIES,
} from './deviceCapabilities.js'

test('detects android from android_* columns', () => {
  assert.equal(detectPlatform({ android_id: 'abc' }), 'android')
  assert.equal(detectPlatform({ android_version: '14' }), 'android')
  assert.equal(detectPlatform({ sdk_version: 34 }), 'android')
})

test('honours an explicit platform field for future platforms', () => {
  assert.equal(detectPlatform({ platform: 'ios' }), 'ios')
  assert.equal(detectPlatform({ platform: 'windows' }), 'windows')
})

test('null device is unknown', () => {
  assert.equal(detectPlatform(null), 'unknown')
})

test('android supports every capability', () => {
  const caps = capabilitiesForDevice({ android_id: 'abc' })
  for (const c of CAPABILITIES) assert.equal(caps[c], true, `android should support ${c}`)
})

test('ios only exposes what is actually built', () => {
  assert.equal(deviceSupports({ platform: 'ios' }, 'location'), true)
  assert.equal(deviceSupports({ platform: 'ios' }, 'pauseInternet'), false)
  assert.equal(deviceSupports({ platform: 'ios' }, 'appRules'), false)
})

test('unknown/future platforms expose nothing by default', () => {
  assert.equal(deviceSupports({ platform: 'windows' }, 'pauseInternet'), false)
  assert.equal(deviceSupports({ platform: 'freedos' }, 'location'), false)
})
