// =====================================================================
// deviceCapabilities.js — platform capability layer.
//
// Not every OS supports the same parental controls. Rather than pretend
// unsupported features exist, the UI asks this module what a given device
// can actually do and hides/greys the rest. Today only Android is shipped,
// but the shape is ready for iOS / Windows / macOS to slot in later.
//
// Dependency-free → unit-testable with `node --test`.
// =====================================================================

// Canonical list of controllable capabilities used across the app.
export const CAPABILITIES = [
  'pauseInternet',
  'resumeInternet',
  'lockDevice',
  'unlockDevice',
  'appRules',
  'screenTime',
  'websiteFilter',
  'schedules',
  'location',
  'usage',
  'installedApps',
]

function allCaps(value) {
  return CAPABILITIES.reduce((acc, key) => ((acc[key] = value), acc), {})
}

// Per-platform support matrix. Unknown/future platforms default to nothing
// enabled so we never render a control the device can't honour.
export const PLATFORM_CAPABILITIES = {
  android: allCaps(true),
  // Placeholders — deliberately conservative until each is actually built
  // against the official OS APIs. Do NOT flip these on speculatively.
  ios: {
    ...allCaps(false),
    location: true, // via MDM / Screen Time API in future
  },
  windows: allCaps(false),
  macos: allCaps(false),
  unknown: allCaps(false),
}

/**
 * Best-effort platform detection from a pc_devices row. Today every device
 * is Android; the Android-specific columns (android_id / android_version /
 * sdk_version) confirm it. Kept centralised so future platforms only touch
 * this function.
 */
export function detectPlatform(device) {
  if (!device) return 'unknown'
  if (device.platform) return device.platform // future-proofing
  if (device.android_id || device.android_version || device.sdk_version != null) return 'android'
  // Current product is Android-only; assume android rather than 'unknown'
  // so existing enrolled devices (which may lack android_* metadata) still
  // expose their controls.
  return 'android'
}

/** Returns the capability map for a device. */
export function capabilitiesForDevice(device) {
  const platform = detectPlatform(device)
  return PLATFORM_CAPABILITIES[platform] ?? PLATFORM_CAPABILITIES.unknown
}

/** Convenience: does this device support a single capability? */
export function deviceSupports(device, capability) {
  return Boolean(capabilitiesForDevice(device)[capability])
}

export const PLATFORM_LABEL = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  unknown: 'Unknown',
}
