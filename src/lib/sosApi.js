/**
 * sosApi.js
 * Fires a SOS event from the child device:
 *   1. Inserts a row into pc_sos_events (with current GPS coords if available)
 *   2. Inserts a critical alert into pc_alerts so the parent dashboard shows it
 *      (which the 70_qustodio_parity.sql bridge turns into a parent push)
 *
 * Two independent paths, because SOS has to work on the worst day:
 *   - the normal Supabase JS client, and
 *   - a NATIVE fallback (dpc.fireSos → SosReporter.kt) that re-authenticates
 *     from the device's own stored refresh token, so a stale/refused WebView
 *     session can't swallow an emergency.
 *
 * Location is best-effort and time-boxed. It must never delay the alert:
 * a cached fix is requested with a short timeout, and a failure just sends
 * null coordinates rather than holding the SOS.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'

/** Hard cap on the location wait — beyond this the parent is better served by an alert with no coordinates. */
const LOCATION_TIMEOUT_MS = 4000

export async function fireSOS(notes = '') {
  const creds = loadDeviceCreds()
  const { latitude, longitude, accuracy } = await tryGetPosition()

  if (creds?.deviceId && creds?.childId && creds?.accessToken && creds?.refreshToken) {
    try {
      await fireViaSupabase(creds, notes, latitude, longitude, accuracy)
      return { ok: true, via: 'supabase' }
    } catch (err) {
      // Fall through to the native path rather than surfacing this — the
      // child pressed SOS, so every remaining option gets tried first.
      console.warn('[sos] Supabase path failed, trying native:', err?.message)
    }
  }

  const native = await dpc.fireSos({ notes, latitude, longitude })
  if (native?.success) return { ok: true, via: 'native' }

  throw new Error(
    creds?.deviceId
      ? 'Could not reach your parents right now. Check the internet connection and try again.'
      : 'This device is not paired yet, so SOS cannot be sent.',
  )
}

async function fireViaSupabase(creds, notes, latitude, longitude, accuracy) {
  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  })
  if (sessionErr) throw new Error(`Session error: ${sessionErr.message}`)

  const now = new Date().toISOString()

  const { error: sosError } = await supabase.from('pc_sos_events').insert({
    device_id: creds.deviceId,
    child_id: creds.childId,
    latitude,
    longitude,
    accuracy_meters: accuracy,
    notes,
    occurred_at: now,
  })
  if (sosError) throw sosError

  // The alert is what actually notifies the parent, so a failure here is
  // NOT swallowed the way it used to be — it escalates to the native path.
  const { error: alertError } = await supabase.from('pc_alerts').insert({
    child_id: creds.childId,
    device_id: creds.deviceId,
    alert_type: 'sos',
    severity: 'critical',
    title: 'SOS — Immediate attention needed',
    body: notes || 'Your child pressed the SOS button.',
    metadata: { latitude, longitude },
    occurred_at: now,
  })
  if (alertError) throw alertError
}

async function tryGetPosition() {
  try {
    const pos = await getCurrentPosition()
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
  } catch {
    return { latitude: null, longitude: null, accuracy: null }
  }
}

function getCurrentPosition(timeout = LOCATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'))
    // maximumAge lets a fix from the last two minutes answer instantly;
    // enableHighAccuracy would wait on GPS, which indoors can mean 30s+.
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout,
      maximumAge: 120000,
    })
    // Belt and braces: some Android WebViews never call either callback
    // when the location permission was permanently denied.
    setTimeout(() => reject(new Error('Location timed out')), timeout + 500)
  })
}
