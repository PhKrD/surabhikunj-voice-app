/**
 * deviceIdentity.js
 * Server-authoritative resolution of which child this device belongs to.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Enrollment used to write child_id into localStorage once, and every
 * enforcement pass read it from there. The parent app can reassign a device
 * to a different child (reassignDevice() in parentalControlApi.js), which
 * updates pc_devices.child_id — but the device never noticed. It kept
 * querying pc_app_rules for the OLD child, found zero rules, and enforced
 * nothing. From the parent's side the rules looked perfectly fine.
 *
 * The device row is the single source of truth. We re-read it on a cadence
 * and whenever enforcement is about to run, then repair the local cache.
 *
 * Requires RLS policy "pc_children_device_select" from migration 61 for the
 * policy_version read; the pc_devices read has always been permitted by
 * "pc_devices_device_select". If migration 61 has not been applied yet the
 * child lookup degrades gracefully and we still get the corrected child_id.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds, saveDeviceCreds } from './deviceStore.js'

// Re-reading the device row on every 2s poll tick would be wasteful. The
// only thing that changes is reassignment (rare) and policy_version (which
// we also learn from the rules themselves), so once a minute is plenty.
const IDENTITY_TTL_MS = 60_000

let lastResolvedAt = 0
let cached = null

/**
 * @returns {Promise<{
 *   deviceId: string,
 *   childId: string|null,
 *   policyVersion: number|null,
 *   reassigned: boolean,
 *   revoked: boolean,
 *   error: string|null
 * }|null>}
 */
export async function resolveDeviceIdentity({ force = false } = {}) {
  const creds = loadDeviceCreds()
  if (!creds?.deviceId) return null

  if (!force && cached && Date.now() - lastResolvedAt < IDENTITY_TTL_MS) {
    return cached
  }

  const { data: device, error } = await supabase
    .from('pc_devices')
    .select('id, child_id, is_active')
    .eq('id', creds.deviceId)
    .maybeSingle()

  if (error) {
    // Network/auth failure — keep operating on the cached identity rather
    // than dropping enforcement. Offline devices must keep enforcing.
    return {
      deviceId: creds.deviceId,
      childId: creds.childId ?? null,
      policyVersion: cached?.policyVersion ?? null,
      reassigned: false,
      revoked: false,
      error: error.message,
    }
  }

  if (!device) {
    // The row is gone or RLS no longer matches us: the parent removed this
    // device. Report it so the caller can stop enforcing and show a
    // re-pair screen instead of silently doing nothing.
    const result = {
      deviceId: creds.deviceId,
      childId: creds.childId ?? null,
      policyVersion: null,
      reassigned: false,
      revoked: true,
      error: null,
    }
    cached = result
    lastResolvedAt = Date.now()
    return result
  }

  const reassigned = Boolean(device.child_id) && device.child_id !== creds.childId

  if (reassigned) {
    console.warn(
      '[deviceIdentity] Device was reassigned:',
      creds.childId, '→', device.child_id, '— repairing local cache',
    )
    saveDeviceCreds({ ...creds, childId: device.child_id })
  }

  // policy_version lives on pc_children and only exists after migration 61.
  let policyVersion = null
  if (device.child_id) {
    const { data: child, error: childErr } = await supabase
      .from('pc_children')
      .select('policy_version')
      .eq('id', device.child_id)
      .maybeSingle()
    if (!childErr && child && Number.isFinite(Number(child.policy_version))) {
      policyVersion = Number(child.policy_version)
    }
  }

  const result = {
    deviceId: device.id,
    childId: device.child_id ?? null,
    policyVersion,
    reassigned,
    revoked: device.is_active === false,
    error: null,
  }

  cached = result
  lastResolvedAt = Date.now()
  return result
}

/** Forces the next resolveDeviceIdentity() call to hit the network. */
export function invalidateDeviceIdentity() {
  lastResolvedAt = 0
  cached = null
}

/**
 * Writes the device's self-diagnostic snapshot back to pc_devices so the
 * parent dashboard can show what is genuinely happening on the device
 * instead of assuming the rules it wrote are in force.
 *
 * Columns added in migration 61. If they don't exist yet PostgREST returns
 * PGRST204 ("column not found"); we detect that and fall back to a plain
 * heartbeat so older databases keep working.
 */
let policyColumnsMissing = false

export async function reportEnforcementState(deviceId, { policyVersion, state }) {
  if (!deviceId) return { ok: false, reason: 'no_device' }

  const heartbeat = { last_seen_at: new Date().toISOString() }

  if (policyColumnsMissing) {
    const { error } = await supabase.from('pc_devices').update(heartbeat).eq('id', deviceId)
    return { ok: !error, degraded: true, reason: error?.message }
  }

  const { error } = await supabase
    .from('pc_devices')
    .update({
      ...heartbeat,
      applied_policy_version: policyVersion ?? null,
      last_enforcement_at: new Date().toISOString(),
      enforcement_state: state ?? null,
      platform: 'android',
    })
    .eq('id', deviceId)

  if (error) {
    const missingColumn =
      error.code === 'PGRST204' || /column .* does not exist|could not find/i.test(error.message ?? '')
    if (missingColumn) {
      console.warn('[deviceIdentity] policy columns absent (migration 61 not applied) — heartbeat only')
      policyColumnsMissing = true
      const { error: fallbackErr } = await supabase.from('pc_devices').update(heartbeat).eq('id', deviceId)
      return { ok: !fallbackErr, degraded: true, reason: 'migration_61_pending' }
    }
    return { ok: false, reason: error.message }
  }

  return { ok: true, degraded: false }
}
