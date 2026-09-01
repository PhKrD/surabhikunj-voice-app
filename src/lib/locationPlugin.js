/**
 * locationPlugin.js
 * JS bridge to the native VoiceKidsLocationPlugin (android/.../VoiceKidsLocationPlugin.kt).
 *
 * Responsibilities:
 *   - Push the current Supabase session into native SharedPreferences so the
 *     background foreground service (VoiceKidsMonitorService) can report
 *     location + geofence events even when the WebView isn't running.
 *   - Start/stop the foreground service (requests runtime location
 *     permissions on first call).
 *
 * Call `syncSessionAndStartTracking()` once right after enrollment, and
 * again whenever supabase.auth's session refreshes (see main.jsx listener).
 */

import { registerPlugin } from '@capacitor/core'
import { loadDeviceCreds } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'

const NativeLocation = registerPlugin('VoiceKidsLocation')

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

/** Pushes the latest session tokens to native storage. No-op on web. */
export async function syncSession() {
  if (!isNative()) return webFallback()
  const creds = loadDeviceCreds()
  if (!creds?.deviceId) return { success: false, reason: 'not_enrolled' }

  return NativeLocation.updateSession({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    deviceId: creds.deviceId,
    childId: creds.childId,
    orgId: creds.orgId,
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  })
}

/**
 * Syncs the session, then starts the background monitoring service.
 * On a Device Owner–provisioned device, permissions are granted silently
 * (no interactive prompt); otherwise startTracking() falls back to the
 * normal runtime permission request.
 */
export async function syncSessionAndStartTracking() {
  const syncResult = await syncSession()
  if (!isNative()) return syncResult
  if (syncResult.success === false) return syncResult

  await dpc.grantRuntimePermissions().catch(() => {})
  return NativeLocation.startTracking()
}

export async function stopTracking() {
  if (!isNative()) return webFallback()
  return NativeLocation.stopTracking()
}

export async function isTracking() {
  if (!isNative()) return { configured: false, hasLocationPermission: false }
  return NativeLocation.isTracking()
}
