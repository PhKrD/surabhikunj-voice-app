/**
 * sosApi.js
 * Fires a SOS event from the child device:
 *   1. Inserts a row into pc_sos_events (with current GPS coords if available)
 *   2. Inserts a critical alert into pc_alerts so the parent dashboard shows it
 *
 * Location is best-effort — if geolocation is unavailable the SOS still fires
 * with null coordinates so the parent is at least notified immediately.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'

export async function fireSOS(notes = '') {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId || !creds?.childId || !creds?.accessToken || !creds?.refreshToken) {
    throw new Error('Device not enrolled')
  }

  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  })
  if (sessionErr) throw new Error(`Session error: ${sessionErr.message}`)

  let latitude = null
  let longitude = null
  let accuracy = null

  try {
    const pos = await getCurrentPosition()
    latitude = pos.coords.latitude
    longitude = pos.coords.longitude
    accuracy = pos.coords.accuracy
  } catch {
    // Continue without location — still critical to fire the SOS
  }

  const now = new Date().toISOString()

  const { error: sosError } = await supabase
    .from('pc_sos_events')
    .insert({
      device_id: creds.deviceId,
      child_id: creds.childId,
      latitude,
      longitude,
      accuracy_meters: accuracy,
      notes,
      occurred_at: now,
    })

  if (sosError) throw sosError

  // Insert parent-facing alert
  await supabase.from('pc_alerts').insert({
    child_id: creds.childId,
    device_id: creds.deviceId,
    alert_type: 'sos',
    severity: 'critical',
    title: 'SOS — Immediate attention needed',
    body: notes || 'Your child pressed the SOS button.',
    metadata: { latitude, longitude },
    occurred_at: now,
  })

  return { ok: true }
}

function getCurrentPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'))
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout,
      maximumAge: 0,
    })
  })
}
