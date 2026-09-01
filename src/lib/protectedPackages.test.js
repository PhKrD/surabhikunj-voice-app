import test from 'node:test'
import assert from 'node:assert/strict'
import { PROTECTED_PACKAGES, isProtectedPackage } from './protectedPackages.js'

test('the emergency dialer and agent package are protected', () => {
  assert.equal(isProtectedPackage('com.android.server.telecom'), true)
  assert.equal(isProtectedPackage('com.surabhikunj.voice.kids'), true)
})

test('an ordinary app is not protected', () => {
  assert.equal(isProtectedPackage('com.android.chrome'), false)
})

test('every entry in the list round-trips through isProtectedPackage', () => {
  for (const pkg of PROTECTED_PACKAGES) assert.equal(isProtectedPackage(pkg), true)
})
