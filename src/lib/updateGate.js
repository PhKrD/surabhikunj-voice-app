// Pure decision logic for remote update gating (no I/O, so it is unit
// tested). Decides whether an installed app must update, should update, or
// is under maintenance, from the server's platform config.

/**
 * @param {object|null} platform   app_platform_config row (or null if unknown)
 * @param {number|null} versionCode installed APK build; null on the web
 * @param {object} opts
 * @param {boolean} opts.isPlatformAdmin  admins are never locked out
 * @param {number}  opts.dismissedFor     recommended build the user dismissed
 * @returns {{ status: 'ok'|'maintenance'|'update_required', recommended: boolean }}
 */
export function computeGate(platform, versionCode, { isPlatformAdmin = false, dismissedFor = 0 } = {}) {
  const p = platform ?? {}
  if (p.maintenance_enabled && !isPlatformAdmin) return { status: 'maintenance', recommended: false }

  // The web build is always the latest; version gating only applies to APKs.
  if (versionCode == null) return { status: 'ok', recommended: false }

  const min = Number(p.min_native_version_code) || 0
  if (min && versionCode < min) return { status: 'update_required', recommended: false }

  const rec = Number(p.recommended_native_version_code) || 0
  const recommended = Boolean(rec && versionCode < rec && dismissedFor < rec)
  return { status: 'ok', recommended }
}
