/**
 * parentPin.js
 *
 * The parent's 4–6 digit PIN protects the Settings screens on the child's
 * device that could switch supervision off (see
 * android/.../dpc/SettingsGuard.kt) and any "stop supervising" action in
 * the app itself.
 *
 * Only the hash is ever stored or transmitted — in
 * pc_children.parent_pin_hash, from where PolicyEnforcer pushes it to the
 * device. The hash format MUST stay byte-identical to
 * SettingsGuard.hashPin(): sha256("<pin>:<childId>"), lower-case hex. The
 * child id acts as a per-child salt so the same PIN on two children
 * produces different hashes, and a stolen hash can't be replayed against
 * another family's child.
 *
 * This is a UI gate on a device the child physically holds, not a secret
 * that survives a determined attacker with root — a 4-digit space is
 * brute-forceable offline by anyone who can read the hash. It is exactly
 * as strong as the equivalent feature in every mainstream parental
 * control, and no stronger; don't reuse it to protect anything else.
 */

const PIN_PATTERN = /^\d{4,6}$/

export function isValidPin(pin) {
  return PIN_PATTERN.test((pin ?? '').trim())
}

export async function hashPin(pin, childId) {
  const data = new TextEncoder().encode(`${String(pin).trim()}:${childId}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
