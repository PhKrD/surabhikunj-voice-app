/**
 * deviceStore.js
 * Persists the child device's credentials to localStorage so the app
 * survives restarts without re-pairing.
 *
 * Fields stored:
 *   deviceId     - UUID of this device's pc_devices row
 *   childId      - UUID of the pc_children row this device belongs to
 *   orgId        - UUID of the parent organization
 *   accessToken  - Supabase access token for the device auth user
 *   refreshToken - Supabase refresh token
 *   enrolledAt   - ISO timestamp of enrollment
 *   isOrgMember  - true when this device's auth session is a REAL VOICE
 *                  org member's own account (pc_children.linked_profile_id
 *                  was set at pairing time — see 68_child_org_link_and_tamper.sql),
 *                  not a throwaway device-only account. Drives whether
 *                  App.jsx shows the full org app (+ a "Family" section)
 *                  or the legacy fully-isolated child experience.
 */

const KEY = 'vk_device_creds'

export function saveDeviceCreds(creds) {
  localStorage.setItem(KEY, JSON.stringify(creds))
}

export function loadDeviceCreds() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearDeviceCreds() {
  localStorage.removeItem(KEY)
}

/** Merges fresh tokens into the stored creds (call on Supabase auth token refresh). */
export function updateDeviceTokens(accessToken, refreshToken) {
  const creds = loadDeviceCreds()
  if (!creds) return null
  const updated = { ...creds, accessToken, refreshToken }
  saveDeviceCreds(updated)
  return updated
}

export function isEnrolled() {
  const creds = loadDeviceCreds()
  return !!(creds?.deviceId && creds?.accessToken)
}

/** True when this device is paired AND its session is a real org member's own account. */
export function isOrgMemberDevice() {
  return !!loadDeviceCreds()?.isOrgMember
}
