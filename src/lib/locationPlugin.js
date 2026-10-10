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
import { supabase } from './supabase.js'

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

  await ensureIndependentNativeSession().catch(() => {})
  await dpc.grantRuntimePermissions().catch(() => {})
  return NativeLocation.startTracking()
}

let provisioning = null

/**
 * Gives the native background layer its OWN Supabase session (via the
 * pc-device-session edge function) instead of sharing the WebView's.
 *
 * Shared, the two sides refreshed one rotating refresh token; the second
 * refresh reused a spent token, Supabase revoked the session, and the phone
 * silently stopped hearing from the parent. Runs once per device (and again
 * if native reports its session died). APKs without getSessionState are
 * left alone: they would let the WebView overwrite the new tokens, so
 * provisioning there would only pile up sessions.
 */
export async function ensureIndependentNativeSession() {
  if (!isNative()) return { skipped: 'web' }
  if (provisioning) return provisioning
  provisioning = (async () => {
    let state
    try {
      state = await NativeLocation.getSessionState()
    } catch {
      return { skipped: 'old_apk' }
    }
    if (!state?.configured) return { skipped: 'not_configured' }
    if (state.independentSession && !state.sessionInvalidSince) return { ok: true, already: true }

    const creds = loadDeviceCreds()
    if (!creds?.deviceId) return { skipped: 'not_enrolled' }
    const { data, error } = await supabase.functions.invoke('pc-device-session', {
      body: { device_id: creds.deviceId },
    })
    if (error || !data?.access_token || !data?.refresh_token) return { ok: false, error: error?.message }
    await NativeLocation.updateSession({
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      deviceId: creds.deviceId,
      childId: creds.childId,
      orgId: creds.orgId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      independentSession: true,
    })
    return { ok: true }
  })()
  try {
    return await provisioning
  } finally {
    provisioning = null
  }
}

export async function stopTracking() {
  if (!isNative()) return webFallback()
  return NativeLocation.stopTracking()
}

export async function clearNativeSession() {
  if (!isNative()) return webFallback()
  return NativeLocation.clearSession()
}

export async function isTracking() {
  if (!isNative()) return { configured: false, hasLocationPermission: false }
  return NativeLocation.isTracking()
}
