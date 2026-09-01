/**
 * bonusTimeApi.js
 * Child device requests extra screen time from the parent.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'

export async function requestBonusTime({ requestedMin, reason }) {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId || !creds?.childId || !creds?.accessToken || !creds?.refreshToken) {
    throw new Error('Device not enrolled')
  }

  // Ensure the Supabase client uses this device's session.
  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  })
  if (sessionErr) throw new Error(`Session error: ${sessionErr.message}`)

  const { error } = await supabase
    .from('pc_bonus_time_requests')
    .insert({
      child_id: creds.childId,
      device_id: creds.deviceId,
      requested_min: requestedMin,
      reason,
    })

  if (error) throw error

  // Alert parent
  await supabase.from('pc_alerts').insert({
    child_id: creds.childId,
    device_id: creds.deviceId,
    alert_type: 'bonus_time_requested',
    severity: 'info',
    title: 'Bonus screen time requested',
    body: `${requestedMin} min requested${reason ? `: "${reason}"` : ''}`,
    metadata: { requested_min: requestedMin },
  })
}
