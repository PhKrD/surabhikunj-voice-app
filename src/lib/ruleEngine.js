/**
 * ruleEngine.js
 * Device-side glue between the WebView and the NATIVE policy engine.
 *
 * The authoritative enforcement engine is android/.../dpc/PolicyEnforcer.kt,
 * running inside VoiceKidsMonitorService on its own 4s cadence regardless
 * of whether this WebView is alive. It implements the default
 * no-factory-reset model (Device Admin + Accessibility soft-block, with
 * Device Owner as an optional bonus layer) — see DpcActions.kt and
 * PLATFORM_LIMITATIONS.md.
 *
 * This module therefore no longer duplicates enforcement decisions in JS
 * (the previous version still ran the OLD Device-Owner-only model here and
 * kept publishing `last_error: not_device_owner` + a "must be
 * re-provisioned" alert every 15 minutes on perfectly healthy Device Admin
 * devices — that was the red "Enforcement error" parents saw). What it
 * still owns:
 *
 *   1. Server-authoritative identity: detect that the parent removed this
 *      device (revocation) or moved it to another child (reassignment) and
 *      react — see deviceIdentity.js.
 *   2. Nudging the native engine for an IMMEDIATE pass after a command that
 *      changes policy (bonus time, sync_rules), instead of waiting for the
 *      next tick.
 *
 * The pure decision logic in policy.js / screenTimePolicy.js remains the
 * unit-tested reference the Kotlin port is kept in sync with.
 */

import { loadDeviceCreds } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'
import { resolveDeviceIdentity } from './deviceIdentity.js'
import { saveEnforcementState } from './enforcementStore.js'

// Nudge the native engine at most this often from the 2s poll loop; it runs
// on its own every 4s anyway, so this only matters for forced passes.
const NUDGE_INTERVAL_MS = 30_000
let lastNudgeAt = 0
let inFlight = false

/**
 * Runs one identity check and (when warranted) nudges the native engine.
 * @returns {Promise<object>} a small diagnostic summary
 */
export async function enforceRules({ force = false } = {}) {
  if (inFlight) return { skipped: true, reason: 'already_running' }
  inFlight = true
  try {
    return await runPass({ force })
  } catch (err) {
    console.error('[ruleEngine] pass threw:', err?.message)
    return { skipped: true, reason: 'exception', error: err?.message }
  } finally {
    inFlight = false
  }
}

async function runPass({ force }) {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId) return { skipped: true, reason: 'not_enrolled' }

  const identity = await resolveDeviceIdentity({ force })
  if (!identity) return { skipped: true, reason: 'not_enrolled' }

  if (identity.revoked) {
    // The parent removed or deactivated this device. Tell the app shell to
    // prompt re-pairing; the native service stops enforcing on its own once
    // its session is cleared by the shell.
    window.dispatchEvent(new Event('vk:device_revoked'))
    return { skipped: true, reason: 'device_revoked' }
  }

  if (!identity.childId) return { skipped: true, reason: 'no_child' }

  const now = Date.now()
  if (force || identity.reassigned || now - lastNudgeAt > NUDGE_INTERVAL_MS) {
    lastNudgeAt = now
    await dpc.enforceNow().catch(() => {})
  }

  saveEnforcementState({ policyVersion: identity.policyVersion })
  return { applied: true, policyVersion: identity.policyVersion, native: true }
}

/** Clears in-memory state so the next pass re-reads identity and nudges immediately. */
export function resetRuleEngine() {
  lastNudgeAt = 0
  saveEnforcementState({ signature: null })
}
