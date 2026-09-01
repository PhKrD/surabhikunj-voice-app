/**
 * enforcementStore.js
 * Durable record of what this device has ACTUALLY applied.
 *
 * Why this exists: the previous implementation tracked suspended packages
 * in a module-level array, which was lost on every app restart. After a
 * restart the device believed nothing was suspended, so removing a rule
 * never released the app — it stayed suspended at the OS level forever.
 *
 * Persisting the applied-state is what makes reconciliation correct across
 * process death, reboots and OTA updates. It is deliberately small and
 * corruption-tolerant: any parse failure degrades to "we know nothing",
 * which triggers a full reconcile against the installed-package list
 * rather than leaving the device stuck.
 */

const KEY = 'vk_enforcement_state'

const EMPTY = Object.freeze({
  suspended: [],
  signature: null,
  policyVersion: null,
  appliedAt: null,
  scheduleLock: false,
})

export function loadEnforcementState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw)
    return {
      suspended: Array.isArray(parsed.suspended) ? parsed.suspended.filter((p) => typeof p === 'string') : [],
      signature: typeof parsed.signature === 'string' ? parsed.signature : null,
      policyVersion: Number.isFinite(parsed.policyVersion) ? parsed.policyVersion : null,
      appliedAt: typeof parsed.appliedAt === 'string' ? parsed.appliedAt : null,
      scheduleLock: parsed.scheduleLock === true,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveEnforcementState(patch) {
  const next = { ...loadEnforcementState(), ...patch, appliedAt: new Date().toISOString() }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage full or unavailable — enforcement still works this tick, we
    // just lose the cache and will do a full reconcile next time.
  }
  return next
}

export function clearEnforcementState() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing we can do */
  }
}

/**
 * True when we have never persisted an applied-state (fresh install, data
 * cleared, upgrade from a build that didn't have this store). Callers use
 * it to decide whether to pay for a full installed-package sweep.
 */
export function needsFullReconcile() {
  const state = loadEnforcementState()
  return state.appliedAt === null
}
