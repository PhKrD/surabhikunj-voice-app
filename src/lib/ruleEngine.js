/**
 * ruleEngine.js
 * Device-side enforcement of schedules and per-app rules.
 *
 * Responsibilities are deliberately thin here — all decision logic lives in
 * policy.js (pure, unit-tested). This module only does I/O:
 *
 *   1. resolve WHICH child this device belongs to, from the server
 *   2. fetch that child's schedules + app rules
 *   3. ask policy.js what the desired state is
 *   4. diff desired against the persisted applied-state
 *   5. issue the minimum set of native DPC calls
 *   6. persist the new applied-state and report it back to the parent
 *
 * Correctness properties this design guarantees, each of which was broken
 * in the previous version:
 *
 *   • Removing a rule always releases the app, even across app restarts,
 *     because applied-state is persisted (enforcementStore) rather than
 *     held in a module variable.
 *   • A device reassigned to another child self-heals within 60s instead
 *     of enforcing a stale child's (empty) rule set forever.
 *   • Only one enforcement pass runs at a time. The poller fires every 2s
 *     without awaiting, so overlapping passes previously raced each other
 *     into contradictory suspend/unsuspend calls.
 *   • The emergency dialer can never be suspended.
 *   • Enforcement failures are rate-limited instead of writing an alert row
 *     on every 2s tick.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'
import { getTodayUsage, hasUsageAccess, getInstalledPackages } from './usageStatsPlugin.js'
import { isBonusActive } from './commandPoller.js'
import { resolveDeviceIdentity, reportEnforcementState } from './deviceIdentity.js'
import { loadEnforcementState, saveEnforcementState, needsFullReconcile } from './enforcementStore.js'
import { resolvePolicy, diffSuspension, policySignature, usageMapFromApps } from './policy.js'

// One enforcement pass at a time. The 2s poller calls this without
// awaiting, so without a guard two passes could interleave between the
// "read applied-state" and "write applied-state" steps and each undo the
// other's work.
let inFlight = false

// The full installed-package sweep is the authoritative reconcile but it
// costs a PackageManager round trip, so we only pay for it when the cache
// is cold or periodically to heal drift.
const FULL_RECONCILE_INTERVAL_MS = 10 * 60_000
let lastFullReconcileAt = 0

// Enforcement-failure alerts were previously written on every poll tick,
// which floods the parent's alert feed. One per failure kind per 15 min.
const ALERT_COOLDOWN_MS = 15 * 60_000
const lastAlertAt = new Map()

let deviceOwnerCache = null

async function checkDeviceOwner() {
  if (deviceOwnerCache !== null) return deviceOwnerCache
  try {
    const result = await dpc.isDeviceOwner()
    deviceOwnerCache = Boolean(result?.isDeviceOwner)
    if (!deviceOwnerCache) {
      console.warn('[ruleEngine] Not Device Owner — app blocking is unavailable on this device')
    }
  } catch (err) {
    console.error('[ruleEngine] Device Owner check failed:', err?.message)
    deviceOwnerCache = false
  }
  return deviceOwnerCache
}

export async function fetchSchedules(childId) {
  const { data, error } = await supabase.from('pc_schedules').select('*').eq('child_id', childId)
  if (error) {
    console.error('[ruleEngine] schedules fetch failed:', error.message)
    return null
  }
  return data ?? []
}

export async function fetchAppRules(childId) {
  const { data, error } = await supabase.from('pc_app_rules').select('*').eq('child_id', childId)
  if (error) {
    console.error('[ruleEngine] app rules fetch failed:', error.message)
    return null
  }
  return data ?? []
}

/**
 * Runs one full enforcement pass.
 * @returns {Promise<object>} a diagnostic summary (also mirrored to the parent)
 */
export async function enforceRules({ force = false } = {}) {
  if (inFlight) return { skipped: true, reason: 'already_running' }
  inFlight = true
  try {
    return await runEnforcement({ force })
  } catch (err) {
    console.error('[ruleEngine] enforcement pass threw:', err?.message)
    return { skipped: true, reason: 'exception', error: err?.message }
  } finally {
    inFlight = false
  }
}

async function runEnforcement({ force }) {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId) return { skipped: true, reason: 'not_enrolled' }

  // ── 1. Identity, from the server ──────────────────────────────────
  const identity = await resolveDeviceIdentity()
  if (!identity) return { skipped: true, reason: 'not_enrolled' }

  if (identity.revoked) {
    // The parent removed or deactivated this device. Release everything we
    // suspended so we don't leave the child locked out of their own phone,
    // then stop enforcing and tell the app shell to prompt re-pairing.
    await releaseAll('device_revoked')
    window.dispatchEvent(new Event('vk:device_revoked'))
    return { skipped: true, reason: 'device_revoked' }
  }

  const childId = identity.childId
  if (!childId) return { skipped: true, reason: 'no_child' }

  // A reassignment invalidates everything we thought we knew.
  const forcePass = force || identity.reassigned

  // ── 2. Capability check ───────────────────────────────────────────
  const isOwner = await checkDeviceOwner()

  // ── 3. Fetch policy inputs ────────────────────────────────────────
  const [schedules, rules] = await Promise.all([fetchSchedules(childId), fetchAppRules(childId)])

  // A null result means the query FAILED (vs. [] which means "no rules").
  // Treating a failed fetch as "no rules" would unsuspend every blocked app
  // the moment the network hiccups — a silent, total bypass. Bail instead.
  if (schedules === null || rules === null) {
    return { skipped: true, reason: 'fetch_failed' }
  }

  const { granted: usageAvailable } = await hasUsageAccess()
  const usageByPackage = usageAvailable ? usageMapFromApps((await getTodayUsage()).apps) : {}

  // ── 4. Resolve desired state (pure) ───────────────────────────────
  const resolved = resolvePolicy({
    schedules,
    rules,
    usageByPackage,
    usageAvailable,
    bonusActive: isBonusActive(),
    now: new Date(),
  })

  const signature = policySignature(resolved, identity.policyVersion)
  const applied = loadEnforcementState()

  // ── 5. Decide whether a full sweep is warranted ───────────────────
  const wantFullSweep =
    forcePass ||
    needsFullReconcile() ||
    Date.now() - lastFullReconcileAt > FULL_RECONCILE_INTERVAL_MS

  const stateUnchanged = signature === applied.signature && !resolved.activeSchedule

  if (stateUnchanged && !wantFullSweep) {
    // Nothing to do. Still refresh the heartbeat so the parent's
    // online/offline indicator stays accurate.
    return { skipped: true, reason: 'unchanged', blocked: applied.suspended }
  }

  if (!isOwner) {
    // We can read policy but cannot act on it. Say so explicitly rather
    // than reporting a phantom success.
    await maybeAlert('not_device_owner', childId, creds.deviceId, {
      title: 'App blocking is not active on this device',
      body: 'VOICE Kids is not the Device Owner, so app rules cannot be enforced. The device must be re-provisioned.',
    })
    await publishState(creds.deviceId, identity, {
      device_owner: false,
      usage_access: usageAvailable,
      desired_blocked: resolved.blockList,
      suspended_count: 0,
      last_error: 'not_device_owner',
    })
    return { skipped: true, reason: 'not_device_owner', desired: resolved.blockList }
  }

  const results = []

  // ── 6. Schedule-level enforcement ─────────────────────────────────
  if (resolved.activeSchedule) {
    const sched = resolved.activeSchedule
    if (sched.action === 'block_all') {
      const allowed = sched.always_allowed_packages ?? []
      // Never a bare lockDevice(): migration 61 guarantees the emergency
      // dialer is present in always_allowed_packages, so an allow-list is
      // always the safer primitive.
      const res = allowed.length > 0 ? await dpc.setAllowedPackages(allowed) : await dpc.lockDevice()
      results.push({ type: 'schedule_block_all', schedule: sched.name, result: res })
    } else if (sched.action === 'block_internet') {
      results.push({ type: 'schedule_block_internet', schedule: sched.name, result: await dpc.pauseInternet() })
    } else if (sched.action === 'allow_list_only') {
      const res = await dpc.setAllowedPackages(sched.always_allowed_packages ?? [])
      results.push({ type: 'schedule_allow_list', schedule: sched.name, result: res })
    }
    saveEnforcementState({ scheduleLock: true })
  } else if (applied.scheduleLock) {
    // A schedule window just closed — undo what it imposed.
    results.push({ type: 'schedule_release_unlock', result: await dpc.unlockDevice() })
    results.push({ type: 'schedule_release_internet', result: await dpc.resumeInternet() })
    saveEnforcementState({ scheduleLock: false })
  }

  // ── 7. App-level reconciliation ───────────────────────────────────
  let installed = null
  if (wantFullSweep) {
    installed = await safeInstalledPackages()
    if (installed) lastFullReconcileAt = Date.now()
  }

  const { toSuspend, toUnsuspend, nextApplied } = diffSuspension(
    applied.suspended,
    resolved.blockList,
    installed,
  )

  let suspendOk = true
  if (toSuspend.length > 0) {
    const res = await dpc.suspendPackages(toSuspend)
    suspendOk = res?.success !== false
    results.push({ type: 'suspend', packages: toSuspend, result: res })
  }

  let unsuspendOk = true
  if (toUnsuspend.length > 0) {
    const res = await dpc.unsuspendPackages(toUnsuspend)
    unsuspendOk = res?.success !== false
    results.push({ type: 'unsuspend', packages: toUnsuspend, result: res })
  }

  if (resolved.allowList.length > 0 && resolved.activeSchedule) {
    // Allow-lists only mean anything while a kiosk/allow-list schedule is
    // active; applying setLockTaskPackages otherwise has no visible effect
    // and would be a misleading no-op.
    results.push({ type: 'allow_list', packages: resolved.allowList, result: await dpc.setAllowedPackages(resolved.allowList) })
  }

  // ── 8. Persist applied-state — only what actually succeeded ───────
  const settled = suspendOk && unsuspendOk
  saveEnforcementState({
    suspended: settled ? nextApplied : applied.suspended,
    signature: settled ? signature : null, // null forces a retry next tick
    policyVersion: identity.policyVersion,
  })

  // ── 9. Report the truth back to the parent ────────────────────────
  await publishState(creds.deviceId, identity, {
    device_owner: true,
    usage_access: usageAvailable,
    active_schedule: resolved.activeSchedule?.name ?? null,
    suspended: settled ? nextApplied : applied.suspended,
    suspended_count: (settled ? nextApplied : applied.suspended).length,
    full_sweep: Boolean(installed),
    skipped_rules: resolved.skipped,
    last_error: settled ? null : 'partial_apply_failure',
  })

  for (const r of results) {
    if (r.result?.success === false) {
      await maybeAlert(`enforce_${r.type}`, childId, creds.deviceId, {
        title: `Could not apply "${r.type}"`,
        body: `Reason: ${r.result?.reason ?? 'unknown'}.`,
        metadata: { type: r.type, packages: r.packages, reason: r.result?.reason },
      })
    }
  }

  return {
    applied: true,
    policyVersion: identity.policyVersion,
    schedule: resolved.activeSchedule?.name ?? null,
    blocked: nextApplied,
    suspended: toSuspend,
    released: toUnsuspend,
    fullSweep: Boolean(installed),
    results,
  }
}

/** Releases everything we ever suspended. Used when the device is revoked. */
async function releaseAll(reason) {
  const applied = loadEnforcementState()
  if (applied.suspended.length === 0 && !applied.scheduleLock) return
  console.warn('[ruleEngine] releasing all restrictions:', reason)
  if (applied.suspended.length > 0) await dpc.unsuspendPackages(applied.suspended)
  if (applied.scheduleLock) {
    await dpc.unlockDevice()
    await dpc.resumeInternet()
  }
  saveEnforcementState({ suspended: [], signature: null, scheduleLock: false })
}

/**
 * Installed-package list for the authoritative sweep. Returns null when
 * unavailable (older APK without the native method) so diffSuspension
 * falls back to cache-only reconciliation instead of unsuspending nothing.
 */
async function safeInstalledPackages() {
  try {
    const res = await getInstalledPackages()
    const list = res?.packages
    if (!Array.isArray(list) || list.length === 0) return null
    return list
  } catch (err) {
    console.warn('[ruleEngine] installed-package sweep unavailable:', err?.message)
    return null
  }
}

async function publishState(deviceId, identity, state) {
  try {
    await reportEnforcementState(deviceId, { policyVersion: identity.policyVersion, state })
  } catch (err) {
    console.warn('[ruleEngine] could not publish enforcement state:', err?.message)
  }
}

/** Writes a parent-facing alert at most once per key per cooldown window. */
async function maybeAlert(key, childId, deviceId, { title, body, metadata }) {
  const last = lastAlertAt.get(key) ?? 0
  if (Date.now() - last < ALERT_COOLDOWN_MS) return
  lastAlertAt.set(key, Date.now())
  try {
    await supabase.from('pc_alerts').insert({
      child_id: childId,
      device_id: deviceId,
      alert_type: 'device_offline',
      severity: 'warning',
      title,
      body,
      metadata: metadata ?? null,
    })
  } catch (err) {
    console.warn('[ruleEngine] alert insert failed:', err?.message)
  }
}

/** Clears in-memory caches so the next pass re-reads everything. */
export function resetRuleEngine() {
  deviceOwnerCache = null
  lastFullReconcileAt = 0
  lastAlertAt.clear()
  saveEnforcementState({ signature: null })
}
