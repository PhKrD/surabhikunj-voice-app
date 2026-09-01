// =====================================================================
// commandStatus.js — pure helpers for the command lifecycle.
//
// The child device transitions a pc_device_commands row through:
//   pending → delivered → executed | failed   (or cancelled)
// The parent UI must reflect the TRUE state, never a premature "success".
// These helpers translate a raw command row (+ the current time) into a
// display state, so the UI never has to reason about timestamps itself.
//
// Kept dependency-free so it can be unit-tested with `node --test`.
// =====================================================================

// A command that hasn't reached a terminal state within this window is
// treated as timed out (device offline, JS crashed mid-execution, etc.).
export const COMMAND_TIMEOUT_MS = 90_000

// A device whose last heartbeat is older than this is considered offline.
export const DEVICE_ONLINE_WINDOW_MS = 3 * 60_000

/** True if the device has sent a heartbeat recently enough to be "online". */
export function isDeviceOnline(device, now = Date.now()) {
  const seen = device?.last_seen_at
  if (!seen) return false
  const t = new Date(seen).getTime()
  if (Number.isNaN(t)) return false
  return now - t < DEVICE_ONLINE_WINDOW_MS
}

/**
 * Reduces a raw command row into one of:
 *   'pending'   — created, child hasn't acked receipt yet
 *   'sent'      — child acked receipt (delivered), executing
 *   'executed'  — child confirmed success
 *   'failed'    — child confirmed failure
 *   'cancelled' — cancelled before execution
 *   'timed_out' — still non-terminal past its expiry window
 *   'unknown'   — no/invalid command
 */
export function deriveCommandState(cmd, now = Date.now()) {
  if (!cmd || !cmd.status) return 'unknown'

  switch (cmd.status) {
    case 'executed':
      return 'executed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'pending':
    case 'delivered':
      break
    default:
      return 'unknown'
  }

  const expiresAt = cmd.expires_at
    ? new Date(cmd.expires_at).getTime()
    : new Date(cmd.created_at).getTime() + COMMAND_TIMEOUT_MS

  if (!Number.isNaN(expiresAt) && now > expiresAt) return 'timed_out'
  return cmd.status === 'delivered' ? 'sent' : 'pending'
}

/** True once a command has reached a state that will never change again. */
export function isTerminalState(state) {
  return state === 'executed' || state === 'failed' || state === 'cancelled' || state === 'timed_out'
}

// Display metadata for each state. `tone` maps to a Badge variant.
export const COMMAND_STATE_META = {
  pending:   { label: 'Pending',   tone: 'default', description: 'Waiting for the device to receive the command…' },
  sent:      { label: 'Sent',      tone: 'blue',    description: 'Device received it — applying now…' },
  executed:  { label: 'Executed',  tone: 'tulasi',  description: 'Confirmed by the device.' },
  failed:    { label: 'Failed',    tone: 'red',     description: 'The device could not perform this action.' },
  cancelled: { label: 'Cancelled', tone: 'default', description: 'Cancelled before it ran.' },
  timed_out: { label: 'Timed out', tone: 'yellow',  description: 'No response — the device may be offline. It will run when the device reconnects.' },
  unknown:   { label: 'Unknown',   tone: 'default', description: '' },
}

// Human labels for command types (parent-facing).
export const COMMAND_TYPE_LABEL = {
  pause_internet:   'Pause internet',
  resume_internet:  'Resume internet',
  lock_device:      'Lock device',
  unlock_device:    'Unlock device',
  grant_bonus_time: 'Grant bonus time',
  revoke_bonus_time:'Revoke bonus time',
  sync_rules:       'Sync rules',
  sos_ack:          'Acknowledge SOS',
  factory_reset:    'Factory reset',
}

export function commandTypeLabel(type) {
  return COMMAND_TYPE_LABEL[type] ?? type
}
