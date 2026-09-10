/**
 * commandPoller.js
 * Polls pc_device_commands every 2s so the child device reacts to parent
 * commands. Also sends a heartbeat (pc_devices.last_seen_at) and re-picks
 * commands stuck in 'delivered' so a crash mid-execution doesn't strand them.
 *
 * Commands handled here:
 *   pause_internet    → dpc.pauseInternet()  (native DevicePolicyManager bridge)
 *   resume_internet   → dpc.resumeInternet() (native DevicePolicyManager bridge)
 *   lock_device       → dpc.lockDevice()     (native DevicePolicyManager bridge)
 *   factory_reset     → dpc.wipeDevice()     (requires payload.confirmed === true)
 *   sync_rules        → re-fetches app rules + schedules and stores locally
 *   grant_bonus_time  → stores bonus expiry in localStorage
 *   revoke_bonus_time → removes bonus expiry from localStorage
 *   sos_ack           → dismisses the SOS confirmation UI
 *
 * Every command's outcome is written back to pc_device_commands
 * (executed/failed + error_message) and failures raise a pc_alerts row
 * so the parent knows enforcement didn't take effect.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds, updateDeviceTokens } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'
import { resetScreenTimeEnforcement } from './screenTimeEngine.js'
import { enforceRules, resetRuleEngine } from './ruleEngine.js'
import { invalidateDeviceIdentity } from './deviceIdentity.js'

const BONUS_KEY = 'vk_bonus_expires_at'

let pollInterval = null
let heartbeatInterval = null
let refreshing = false

// A command the child ACKed (status='delivered') but never confirmed
// executing — e.g. the app was killed mid-execution — would otherwise hang
// forever, because the normal poll only looks at status='pending'. We
// re-pick such commands once they're older than this so they get retried.
// pause/resume/lock/unlock are idempotent so a retry is safe.
const STUCK_DELIVERED_MS = 30_000

// How often the child updates pc_devices.last_seen_at so the parent can show
// an accurate online/offline indicator.
const HEARTBEAT_MS = 45_000

/**
 * Ensures the Supabase client has a live (non-expired) session before we
 * hit the DB. The Capacitor WebView's JS timers can get frozen while the
 * app is backgrounded, so supabase-js's built-in autoRefreshToken sometimes
 * misses its window — this proactively refreshes a few seconds early, and
 * also self-heals reactively if a query still comes back with "JWT expired".
 */
async function ensureFreshSession() {
  if (refreshing) return
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  if (!session) return
  const expiresAt = (session.expires_at ?? 0) * 1000
  const msRemaining = expiresAt - Date.now()
  if (msRemaining > 60_000) return // still good for another minute+

  refreshing = true
  try {
    console.log('[commandPoller] Session expiring soon, refreshing...')
    const { data: refreshed, error } = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token,
    })
    if (error) {
      console.error('[commandPoller] refreshSession failed:', error.message)
      return
    }
    if (refreshed?.session) {
      updateDeviceTokens(refreshed.session.access_token, refreshed.session.refresh_token)
      console.log('[commandPoller] Session refreshed successfully')
    }
  } finally {
    refreshing = false
  }
}

export function startCommandPoller(onCommand) {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId) {
    console.log('[commandPoller] No device credentials, skipping')
    return
  }

  console.log('[commandPoller] Starting polling for device:', creds.deviceId)

  // Clean up any prior polling
  stopCommandPoller()

  // Heartbeat so the parent dashboard can show online/offline accurately.
  sendHeartbeat(creds.deviceId)
  heartbeatInterval = setInterval(() => sendHeartbeat(creds.deviceId), HEARTBEAT_MS)

  // Poll every 2 seconds for pending (and stuck-delivered) commands
  pollInterval = setInterval(async () => {
    try {
      await ensureFreshSession()

      let { data: commands, error } = await fetchActionableCommands(creds.deviceId)

      if (error?.message?.toLowerCase().includes('jwt')) {
        // Reactive fallback: force a refresh and retry once.
        console.warn('[commandPoller] JWT error, forcing refresh and retrying:', error.message)
        const { data: sessData } = await supabase.auth.getSession()
        if (sessData?.session?.refresh_token) {
          await supabase.auth.refreshSession({ refresh_token: sessData.session.refresh_token })
        }
        const retry = await fetchActionableCommands(creds.deviceId)
        commands = retry.data
        error = retry.error
      }

      if (error) {
        console.error('[commandPoller] Query error:', error.message)
        return
      }

      // Identity check (revocation / reassignment) + an occasional nudge of
      // the native policy engine. Actual enforcement — schedules, app
      // rules, daily limits, restricted times — runs natively in
      // PolicyEnforcer.kt on its own cadence; see ruleEngine.js.
      enforceRules().catch((err) => console.warn('[commandPoller] rule engine error:', err.message))

      if (!commands || commands.length === 0) return

      for (const cmd of commands) {
        console.log('[commandPoller] Processing command:', cmd.command_type, cmd.id)

        // ACK delivery
        await supabase
          .from('pc_device_commands')
          .update({ status: 'delivered', delivered_at: new Date().toISOString() })
          .eq('id', cmd.id)

        const result = await handleCommand(cmd)
        console.log('[commandPoller] Command result:', result)

        // ACK execution (or failure)
        await supabase
          .from('pc_device_commands')
          .update({
            status: result.success ? 'executed' : 'failed',
            executed_at: new Date().toISOString(),
            error_message: result.success ? null : (result.reason ?? 'unknown_error'),
          })
          .eq('id', cmd.id)

        if (!result.success) {
          console.log('[commandPoller] Command failed, reporting to parent')
          await reportCommandFailure(cmd, result)
        }

        onCommand?.(cmd)
      }
    } catch (err) {
      console.error('[commandPoller] Polling error:', err.message)
    }
  }, 2000)
}

export function stopCommandPoller() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

/**
 * Fetches commands the child should act on: everything still 'pending',
 * PLUS commands stuck in 'delivered' (ACKed but never confirmed executed)
 * for longer than STUCK_DELIVERED_MS — those are retried so a crash between
 * the delivery-ACK and the execution-ACK doesn't strand the command forever.
 */
async function fetchActionableCommands(deviceId) {
  const stuckBefore = new Date(Date.now() - STUCK_DELIVERED_MS).toISOString()
  return supabase
    .from('pc_device_commands')
    .select('*')
    .eq('device_id', deviceId)
    .or(`status.eq.pending,and(status.eq.delivered,executed_at.is.null,delivered_at.lt.${stuckBefore})`)
    .order('created_at', { ascending: true })
}

/** Updates pc_devices.last_seen_at (device has UPDATE RLS on its own row). */
async function sendHeartbeat(deviceId) {
  try {
    await supabase
      .from('pc_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', deviceId)
  } catch (err) {
    console.warn('[commandPoller] Heartbeat failed:', err?.message)
  }
}

/**
 * Executes a command and returns { success, reason? } so the caller can
 * mark the pc_device_commands row executed/failed accordingly.
 */
async function handleCommand(cmd) {
  switch (cmd.command_type) {
    case 'grant_bonus_time': {
      const { expires_at } = cmd.payload ?? {}
      if (expires_at) localStorage.setItem(BONUS_KEY, expires_at)
      // Mirror into native prefs so the background PolicyEnforcer (which
      // cannot read localStorage) lifts schedules / time limits / the
      // daily cap — see PolicyEnforcer.kt / VoiceKidsDpcPlugin.setBonusExpiry.
      await dpc.setBonusExpiry(expires_at ?? null).catch(() => {})
      resetScreenTimeEnforcement()
      // Bonus time changes every lock decision at once — ask the native
      // engine for an immediate pass rather than waiting for its next tick.
      enforceRules({ force: true }).catch(() => {})
      return { success: true }
    }
    case 'revoke_bonus_time': {
      localStorage.removeItem(BONUS_KEY)
      await dpc.setBonusExpiry(null).catch(() => {})
      resetScreenTimeEnforcement()
      enforceRules({ force: true }).catch(() => {})
      return { success: true }
    }
    case 'sync_rules': {
      // Rules are re-fetched by hooks subscribed to this event.
      window.dispatchEvent(new Event('vk:sync_rules'))
      resetScreenTimeEnforcement()
      resetRuleEngine()
      invalidateDeviceIdentity()
      // force:true makes the native engine drop its input cache and re-read
      // every policy table — this is what lets a parent-triggered sync heal
      // a device that missed an update.
      enforceRules({ force: true }).catch(() => {})
      return { success: true }
    }
    case 'pause_internet':
      return await dpc.pauseInternet()

    case 'resume_internet':
      return await dpc.resumeInternet()

    case 'lock_device':
      // Persistent parent lock (kept by the native engine until unlock) plus
      // an immediate screen lock when Device Admin is active. The persistent
      // part never needs Device Admin, so a missing admin grant is not a
      // failure of the command itself.
      return { ...(await dpc.lockDevice()), success: true }

    case 'unlock_device':
      return await dpc.unlockDevice()

    case 'factory_reset':
      // DESTRUCTIVE — parent app must have already confirmed this twice
      // before writing the command row. We still double-check the payload
      // flag as defense-in-depth.
      if (cmd.payload?.confirmed !== true) {
        return { success: false, reason: 'missing_confirmation' }
      }
      return await dpc.wipeDevice()

    case 'sos_ack':
      window.dispatchEvent(new Event('vk:sos_ack'))
      return { success: true }

    default:
      console.warn(`[commandPoller] Unknown command type: ${cmd.command_type}`)
      return { success: false, reason: 'unknown_command_type' }
  }
}

/** Writes an alert so the parent sees why a command didn't take effect. */
async function reportCommandFailure(cmd, result) {
  const creds = loadDeviceCreds()
  if (!creds?.childId) return
  await supabase.from('pc_alerts').insert({
    child_id: creds.childId,
    device_id: creds.deviceId,
    alert_type: 'device_offline',
    severity: 'warning',
    title: `Command "${cmd.command_type}" failed`,
    body: `Reason: ${result.reason ?? 'unknown'}. Open VOICE on the device and check the setup checklist (Device Admin / VPN permission).`,
    metadata: { command_id: cmd.id, command_type: cmd.command_type, reason: result.reason },
  })
}

export function getBonusExpiresAt() {
  const raw = localStorage.getItem(BONUS_KEY)
  return raw ? new Date(raw) : null
}

export function isBonusActive() {
  const exp = getBonusExpiresAt()
  return exp ? exp > new Date() : false
}
