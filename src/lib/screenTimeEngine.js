/**
 * screenTimeEngine.js
 * Child-device view of the daily screen-time limit.
 *
 * Enforcement itself (locking the device once today's limit is reached,
 * honouring per-weekday limits, the parent's chosen limit action, bonus
 * time and restricted times) is done NATIVELY by
 * android/.../dpc/PolicyEnforcer.kt under plain Device Admin — the
 * previous version of this file refused to do anything unless the device
 * was Device Owner, which is exactly why the daily limit "did nothing" on
 * every normally-set-up phone.
 *
 * This module now only reads the native engine's snapshot so the UI can
 * show the real numbers and the matching lock screen (see
 * src/lib/screenTimePolicy.js LOCK_REASON_COPY).
 */

import { dpc } from './dpcPlugin.js'
import { loadDeviceCreds } from './deviceStore.js'

/**
 * @returns {Promise<{
 *   overLimit: boolean, locked: boolean, lockReason: string|null, lockLabel: string,
 *   totalMinutes: number|null, limitMinutes: number|null, remainingMinutes: number|null,
 *   bonusActive: boolean, reason?: string
 * }>}
 */
export async function enforceScreenTime() {
  const creds = loadDeviceCreds()
  if (!creds?.childId || !creds?.deviceId) {
    return { overLimit: false, locked: false, lockReason: null, lockLabel: '', totalMinutes: null, limitMinutes: null, remainingMinutes: null, bonusActive: false, reason: 'not_enrolled' }
  }
  const snap = await dpc.getEnforcementSnapshot()
  const total = snap.screenTimeTodayMin ?? null
  const limit = snap.screenTimeLimitMin ?? null
  const remaining = total !== null && limit !== null ? Math.max(0, limit - total) : null
  return {
    overLimit: total !== null && limit !== null && total >= limit,
    locked: Boolean(snap.locked),
    lockReason: snap.lockReason ?? null,
    lockLabel: snap.lockLabel ?? '',
    totalMinutes: total,
    limitMinutes: limit,
    remainingMinutes: remaining,
    bonusActive: Boolean(snap.bonusActive),
  }
}

/** Kept for callers that used to clear JS-side state; the native engine has none to reset. */
export function resetScreenTimeEnforcement() {}
