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

  /** Notification permission — the child device needs it for lock/tamper notices. */
  async hasNotificationPermission() {
    if (!isNative()) return { granted: false }
    return NativeDpc.hasNotificationPermission()
  },

  async requestNotificationPermission() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestNotificationPermission()
  },

  async hasLocationPermission() {
    if (!isNative()) return { granted: false }
    return NativeDpc.hasLocationPermission()
  },

  async requestLocationPermission() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestLocationPermission()
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

  /**
   * Recommended, not required — exempts the app from OS battery
   * optimization so VoiceKidsMonitorService (and therefore enforcement +
   * tamper detection) doesn't get silently killed in the background,
   * which would otherwise look identical to actual tampering.
   */
  async isIgnoringBatteryOptimizations() {
    if (!isNative()) return { granted: false }
    return NativeDpc.isIgnoringBatteryOptimizations()
  },

  async requestIgnoreBatteryOptimizations() {
    if (!isNative()) return webFallback()
    return NativeDpc.requestIgnoreBatteryOptimizations()
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

  /**
   * Asks the native PolicyEnforcer (the authoritative engine — see
   * PolicyEnforcer.kt) for an immediate pass instead of waiting for its
   * next 4s tick. Used right after the WebView processes a command that
   * changes policy (bonus time, sync_rules).
   */
  async enforceNow() {
    if (!isNative()) return webFallback()
    return NativeDpc.enforceNow()
  },

  /**
   * Current enforcement state as decided natively: { locked, lockReason,
   * lockLabel, screenTimeTodayMin, screenTimeLimitMin, bonusActive, ... }.
   * Drives the child-facing "Time's up" / "Not now" screens. Resolves a
   * neutral "not locked" shape on web so callers need no platform checks.
   */
  async getEnforcementSnapshot() {
    if (!isNative()) {
      return {
        locked: false, lockReason: null, lockLabel: '', blockAllActive: false, allowListActive: false,
        bonusActive: false, screenTimeTodayMin: null, screenTimeLimitMin: null, blockedPackageCount: 0,
        websiteFilterActive: false, vpnFilteringEnabled: false, internetPaused: false, isDeviceAdmin: false, isDeviceOwner: false,
        accessibilityEnabled: false, usageAccess: false, settingsProtected: false, webPlatform: true,
      }
    }
    return NativeDpc.getEnforcementSnapshot()
  },

  /**
   * Native SOS insert (SosReporter.kt) — the fallback sosApi.js uses when
   * the WebView's own Supabase session can't be established. Coordinates
   * are optional; the native side falls back to the last known fix.
   */
  async fireSos({ notes = '', latitude = null, longitude = null } = {}) {
    if (!isNative()) return webFallback()
    return NativeDpc.fireSos({ notes, latitude, longitude })
  },

  /** { hasPin, protectSettings, graceActive } — see SettingsGuard.kt. */
  async getGuardStatus() {
    if (!isNative()) return { hasPin: false, protectSettings: false, graceActive: false }
    return NativeDpc.getGuardStatus()
  },

  /** Verifies the parent PIN on-device and, on success, stands the settings guard down for 5 minutes. */
  async verifyParentPin(pin) {
    if (!isNative()) return webFallback()
    return NativeDpc.verifyParentPin({ pin })
  },
}
