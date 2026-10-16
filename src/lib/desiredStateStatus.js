// =====================================================================
// desiredStateStatus.js — has the phone actually applied what the parent
// asked for?
//
// "Lock now" and "Pause internet" are desired state on pc_children
// (migration 72). Writing the row only records the intent; the phone
// confirms it by reporting pc_devices.enforcement_state (PolicyEnforcer.kt
// sends a fresh report whenever what it enforces changes). Comparing the
// two lets the parent UI say "Locked on Anmol's phone" instead of guessing.
//
// Pure + dependency-free → unit-tested with `node --test`.
// Relative import so it runs under node.
// =====================================================================
import { isDeviceOnline } from './commandStatus.js'

/** What the phone's report says for each control. */
const REPORTED = {
  lock: (s) => s.lock_reason === 'parent_lock',
  pause: (s) => s.manual_internet_pause === true,
}

/** What the parent asked for, from the child row. */
const WANTED = {
  lock: (child) => Boolean(child?.parent_lock_active),
  pause: (child) => Boolean(child?.internet_pause_active),
}

/**
 * Per-device status for one control:
 *   'applied'  — the phone reports the state the parent wants
 *   'applying' — phone is online but hasn't reported it yet
 *   'waiting'  — phone is offline; it applies this when it reconnects
 *   'unknown'  — the phone has never sent a report
 */
export function deviceControlStatus(kind, child, device, now = Date.now()) {
  const state = device?.enforcement_state
  if (!state || typeof state !== 'object') return 'unknown'
  if (REPORTED[kind](state) === WANTED[kind](child)) return 'applied'
  return isDeviceOnline(device, now) ? 'applying' : 'waiting'
}

const RANK = { waiting: 3, applying: 2, unknown: 1, applied: 0 }

/**
 * The worst status across the child's active devices, plus the devices it
 * applies to. One phone still waiting means the parent's tap hasn't fully
 * landed yet — so the summary never claims "applied" early.
 */
export function controlStatus(kind, child, devices, now = Date.now()) {
  const active = (devices ?? []).filter((d) => d.is_active)
  if (active.length === 0) return { status: 'unknown', devices: [] }
  const perDevice = active.map((d) => ({ device: d, status: deviceControlStatus(kind, child, d, now) }))
  const status = perDevice.reduce((worst, d) => (RANK[d.status] > RANK[worst] ? d.status : worst), 'applied')
  return { status, devices: perDevice }
}

/** Short parent-facing line for a control's status. */
export function controlStatusLabel(kind, wanted, status) {
  const on = { lock: 'Locked', pause: 'Paused' }[kind]
  const off = { lock: 'Unlocked', pause: 'Back online' }[kind]
  switch (status) {
    case 'applied': return wanted ? `${on} on the phone` : `${off} on the phone`
    case 'applying': return wanted ? 'Applying on the phone…' : 'Releasing on the phone…'
    case 'waiting': return 'Phone offline — applies when it’s back'
    default: return 'Waiting for the phone’s first report'
  }
}
