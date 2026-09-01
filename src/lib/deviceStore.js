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
