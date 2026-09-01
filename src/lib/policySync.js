// =====================================================================
// policySync.js — pure helpers for the parent-facing "is this device
// actually enforcing what I configured?" indicator.
//
// Requires migration supabase/61_policy_integrity.sql (pc_children.
// policy_version + pc_devices.applied_policy_version / enforcement_state).
// Degrades to 'unknown' when those columns are absent (pre-migration
// database) rather than lying about sync state — see isMigrationApplied().
//
// Dependency-free so it is unit-testable with `node --test`, matching the
// existing pattern in commandStatus.js / deviceCapabilities.js.
// =====================================================================

import { isDeviceOnline } from './commandStatus.js'

/**
 * True once the parent's Supabase project has migration 61 applied.
 * A device row has `applied_policy_version` present (even if null) only
 * after the column exists; `undefined` means PostgREST never returned it
 * because the column doesn't exist yet.
 */
export function isMigrationApplied(device) {
  return device != null && 'applied_policy_version' in device
}

/**
 * Reduces a (device, child) pair into a truthful sync state:
 *
 *   'unknown'    — migration 61 not applied yet; we cannot know
 *   'never'      — device has never reported ANY applied policy
 *   'offline'    — device hasn't been seen recently (see commandStatus.js);
 *                  its last known state may now be stale
 *   'syncing'    — device is online but applied_policy_version is behind
 *                  the child's current policy_version
 *   'in_sync'    — applied_policy_version matches the current version
 *   'error'      — device reported enforcement_state.last_error non-null
 *                  AND is behind or has never synced (device_owner lost,
 *                  usage access revoked, etc.)
 */
export function derivePolicySyncState(device, child, now = Date.now()) {
  if (!isMigrationApplied(device)) return 'unknown'

  const hasError = Boolean(device?.enforcement_state?.last_error)
  const applied = device?.applied_policy_version ?? null
  const current = child?.policy_version ?? null

  if (applied === null) return hasError ? 'error' : 'never'

  const online = isDeviceOnline(device, now)
  const behind = current !== null && applied < current

  if (hasError) return 'error'
  if (!online) return 'offline'
  if (behind) return 'syncing'
  return 'in_sync'
}

export const POLICY_SYNC_META = {
  unknown: { label: 'Sync status unavailable', tone: 'default', description: 'Database migration pending — cannot verify enforcement.' },
  never: { label: 'Never synced', tone: 'default', description: 'This device has not confirmed applying any policy yet.' },
  offline: { label: 'Offline — may be stale', tone: 'default', description: 'Device is offline; the rules shown may not reflect what is currently enforced.' },
  syncing: { label: 'Syncing…', tone: 'yellow', description: 'Device is online and applying the latest changes.' },
  in_sync: { label: 'Rules active', tone: 'tulasi', description: 'This device has confirmed the current rules are enforced.' },
  error: { label: 'Enforcement error', tone: 'red', description: 'The device reported a problem applying rules — see diagnostics.' },
}

/** Human-readable reason for a device.enforcement_state.last_error code. */
export const ENFORCEMENT_ERROR_LABEL = {
  not_device_owner: 'This device is not set up as Device Owner, so app rules cannot be enforced. It must be re-provisioned.',
  partial_apply_failure: 'Some rules could not be applied. The device will retry automatically.',
  no_usage_access: 'Usage Access permission was revoked, so time-limit rules cannot be checked.',
}

export function enforcementErrorLabel(code) {
  return ENFORCEMENT_ERROR_LABEL[code] ?? (code ? `Unrecognized error: ${code}` : null)
}

/**
 * Diagnostic checklist for the device-detail "self-diagnostic" panel
 * (see PLATFORM_LIMITATIONS.md / SECURITY.md §40 self-diagnostic system).
 * Returns an ordered list of { ok, label } so the UI can render ✓ / ⚠ rows
 * without embedding this logic in a component.
 */
export function diagnosticChecklist(device, child, now = Date.now()) {
  const state = device?.enforcement_state ?? {}
  const online = isDeviceOnline(device, now)
  const migrationApplied = isMigrationApplied(device)

  return [
    { key: 'connected', ok: online, label: online ? 'Device connected' : 'Device offline' },
    {
      key: 'device_owner',
      ok: state.device_owner !== false,
      label: state.device_owner === false ? 'Device Owner permission missing' : 'Device Owner active',
    },
    {
      key: 'usage_access',
      ok: state.usage_access !== false,
      label: state.usage_access === false ? 'Usage Access permission missing (time limits inactive)' : 'Usage Access granted',
    },
    {
      key: 'policy_sync',
      ok: migrationApplied ? derivePolicySyncState(device, child, now) === 'in_sync' : null,
      label: migrationApplied
        ? `Policy version ${device?.applied_policy_version ?? '—'} of ${child?.policy_version ?? '—'} applied`
        : 'Policy version tracking unavailable (migration pending)',
    },
    {
      key: 'last_error',
      ok: !state.last_error,
      label: state.last_error ? enforcementErrorLabel(state.last_error) : 'No enforcement errors',
    },
  ]
}
