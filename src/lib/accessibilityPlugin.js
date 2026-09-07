/**
 * accessibilityPlugin.js
 * JS bridge to the native VoiceKidsAccessibilityService — best-effort
 * web/search monitoring. See PLATFORM_LIMITATIONS.md for exactly what
 * this does and doesn't cover before wiring any "is this on?" UI to it.
 */

import { registerPlugin } from '@capacitor/core'

const NativeAccessibility = registerPlugin('VoiceKidsAccessibility')

const isNative = () => {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

export async function hasAccessibilityAccess() {
  if (!isNative()) return { enabled: false }
  return NativeAccessibility.isEnabled()
}

export async function openAccessibilitySettings() {
  if (!isNative()) return { success: false, reason: 'web_platform' }
  return NativeAccessibility.openSettings()
}
