/**
 * dpcPlugin.js
 * JS bridge to the native VoiceKidsDpcPlugin (android/.../VoiceKidsDpcPlugin.kt).
 *
 * This is a LOCAL custom Capacitor plugin (not published to npm) — it's
 * registered directly in MainActivity.java, so we just need registerPlugin()
 * with the matching name to get a typed proxy.
 *
 * On web (browser dev), all methods resolve to { success: false, reason: 'web_platform' }
 * so the UI can be built and tested without a device.
 */

import { registerPlugin } from '@capacitor/core'

const NativeDpc = registerPlugin('VoiceKidsDpc')

const isNative = () => {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

function webFallback(extra = {}) {
  return Promise.resolve({ success: false, reason: 'web_platform', ...extra })
}

export const dpc = {
  async isDeviceOwner() {
    if (!isNative()) return { isDeviceOwner: false, isDeviceAdmin: false }
    return NativeDpc.isDeviceOwner()
  },

  /** Opens the system "Activate this device admin app?" screen — one tap, no reset needed. */
  async requestDeviceAdmin() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestDeviceAdmin()
  },

  /** OPTIONAL "Advanced" mode only — still requires a factory reset. Not part of the default setup flow. */
  async getProvisioningPayload() {
    if (!isNative()) return webFallback()
    return NativeDpc.getProvisioningPayload()
  },

  /** "Draw over other apps" — used for the brief block-screen shown when a disallowed app is kicked to home. */
  async canDrawOverlays() {
    if (!isNative()) return { granted: false }
    return NativeDpc.canDrawOverlays()
  },

  async requestOverlayPermission() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestOverlayPermission()
  },

  /** One-time system consent needed before pause_internet/resume_internet can work. */
  async hasVpnConsent() {
    if (!isNative()) return { granted: false }
    return NativeDpc.hasVpnConsent()
  },

  async requestVpnConsent() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestVpnConsent()
  },

  async suspendPackages(packages) {
    if (!isNative()) return webFallback()
    return NativeDpc.suspendPackages({ packages })
  },

  async unsuspendPackages(packages) {
    if (!isNative()) return webFallback()
    return NativeDpc.unsuspendPackages({ packages })
  },

  async setAllowedPackages(packages) {
    if (!isNative()) return webFallback()
    return NativeDpc.setAllowedPackages({ packages })
  },

  async startKioskMode() {
    if (!isNative()) return webFallback()
    return NativeDpc.startKioskMode()
  },

  async stopKioskMode() {
    if (!isNative()) return webFallback()
    return NativeDpc.stopKioskMode()
  },

  async pauseInternet() {
    if (!isNative()) return webFallback()
    return NativeDpc.pauseInternet()
  },

  async resumeInternet() {
    if (!isNative()) return webFallback()
    return NativeDpc.resumeInternet()
  },

  async lockDevice() {
    if (!isNative()) return webFallback()
    return NativeDpc.lockDevice()
  },

  async unlockDevice() {
    if (!isNative()) return webFallback()
    return NativeDpc.unlockDevice()
  },

  /** DESTRUCTIVE — only call after explicit parent confirmation. */
  async wipeDevice() {
    if (!isNative()) return webFallback()
    return NativeDpc.wipeDevice()
  },

  async disallowFactoryReset() {
    if (!isNative()) return webFallback()
    return NativeDpc.disallowFactoryReset()
  },

  /** Device Owner only — silently grants location/notification permissions without a prompt. */
  async grantRuntimePermissions() {
    if (!isNative()) return webFallback()
    return NativeDpc.grantRuntimePermissions()
  },

  /**
   * Mirrors bonus-time expiry into native SharedPreferences so the
   * background PolicyEnforcer (which cannot read localStorage) also lifts
   * time_limit rules while the app is backgrounded. Does NOT require
   * Device Owner. Pass null to clear (revoke).
   */
  async setBonusExpiry(expiresAtIso) {
    if (!isNative()) return webFallback()
    return NativeDpc.setBonusExpiry({ expiresAt: expiresAtIso ?? null })
  },
}
