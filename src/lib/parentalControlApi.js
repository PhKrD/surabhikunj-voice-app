// =====================================================================
// parentalControlApi.js — data access for the Parental Control module.
//
// Backed by supabase/52_parental_control_schema.sql (pc_* tables) and
// supabase/53_pairing_codes.sql (secure device enrollment). RLS enforces
// that a parent only ever sees children where pc_children.parent_id =
// auth.uid() — this file does not implement any access control itself.
// =====================================================================
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------
// Audit log helper (internal)
// ---------------------------------------------------------------------

/**
 * Records an audit entry for a security-relevant action.
 * Silently fails to avoid blocking the primary operation.
 */
async function recordAudit({ childId, deviceId, action, target, metadata }) {
  try {
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('pc_audit_log').insert({
      child_id: childId,
      device_id: deviceId || null,
      actor_id: userData.user.id,
      action,
      target: target || null,
      metadata: metadata || null,
    })
  } catch (err) {
    console.warn('[parentalControlApi] Failed to record audit:', err.message)
  }
}

// ---------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------

export async function listChildren() {
  const { data, error } = await supabase
    .from('pc_children')
    .select('*, pc_devices(id, device_name, device_owner_mode, is_active, last_seen_at, enrolled_at)')
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createChild({ orgId, displayName, dateOfBirth, ageGroup }) {
  const { data, error } = await supabase
    .from('pc_children')
    .insert({
      org_id: orgId,
      parent_id: (await supabase.auth.getUser()).data.user.id,
      display_name: displayName,
      date_of_birth: dateOfBirth || null,
      age_group: ageGroup || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateChild(childId, patch) {
  const { data, error } = await supabase.from('pc_children').update(patch).eq('id', childId).select().single()
  if (error) throw error
  return data
}

export async function deleteChild(childId) {
  const { error } = await supabase.from('pc_children').delete().eq('id', childId)
  if (error) throw error
}

export async function getChild(childId) {
  const { data, error } = await supabase.from('pc_children').select('*').eq('id', childId).single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------
// Devices + pairing
// ---------------------------------------------------------------------

export async function listDevices(childId) {
  // Embeds the owning child's policy_version so the UI can compute a true
  // sync state (see src/lib/policySync.js) without a second round trip.
  // Falls back to a plain select if migration 61 hasn't added the column
  // yet (embedding a non-existent column errors the whole query).
  const { data, error } = await supabase
    .from('pc_devices')
    .select('*, pc_children(policy_version)')
    .eq('child_id', childId)
    .order('created_at')

  if (error) {
    const { data: fallback, error: fallbackErr } = await supabase
      .from('pc_devices')
      .select('*')
      .eq('child_id', childId)
      .order('created_at')
    if (fallbackErr) throw fallbackErr
    return fallback ?? []
  }
  return (data ?? []).map((d) => ({ ...d, policy_version: d.pc_children?.policy_version ?? null }))
}

/** Calls the pc-generate-pairing-code edge function. Returns { device_id, pairing_code, expires_at }. */
export async function generatePairingCode({ childId, deviceName }) {
  const { data, error } = await supabase.functions.invoke('pc-generate-pairing-code', {
    body: { child_id: childId, device_name: deviceName },
  })
  if (error) throw new Error(error.message || 'Could not generate pairing code')
  if (!data?.ok) throw new Error(data?.error || 'Could not generate pairing code')
  return data
}

export async function removeDevice(deviceId) {
  const { error } = await supabase.from('pc_devices').delete().eq('id', deviceId)
  if (error) throw error
}

export async function renameDevice(deviceId, deviceName) {
  const { error } = await supabase.from('pc_devices').update({ device_name: deviceName }).eq('id', deviceId)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Screen time rules
// ---------------------------------------------------------------------

export async function getScreenTimeRule(childId) {
  const { data, error } = await supabase
    .from('pc_screen_time_rules')
    .select('*')
    .eq('child_id', childId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertScreenTimeRule({ childId, orgId, dailyLimitMin, graceMin, isEnabled }) {
  const { data: existing } = await supabase
    .from('pc_screen_time_rules')
    .select('id')
    .eq('child_id', childId)
    .maybeSingle()

  let resolvedOrgId = orgId
  if (!resolvedOrgId) {
    const { data: child } = await supabase.from('pc_children').select('org_id').eq('id', childId).single()
    resolvedOrgId = child?.org_id
  }

  const payload = {
    child_id: childId,
    org_id: resolvedOrgId,
    daily_limit_min: dailyLimitMin ?? 120,
    grace_min: graceMin ?? 0,
    is_enabled: isEnabled ?? true,
  }

  if (existing?.id) {
    const { data, error } = await supabase.from('pc_screen_time_rules').update(payload).eq('id', existing.id).select().single()
    if (error) throw error

    await recordAudit({
      childId,
      action: 'update_screen_time_rule',
      target: `screen_time:${childId}`,
      metadata: { daily_limit_min: dailyLimitMin ?? 120, grace_min: graceMin ?? 0, is_enabled: isEnabled ?? true },
    })

    return data
  }

  const { data, error } = await supabase.from('pc_screen_time_rules').insert(payload).select().single()
  if (error) throw error

  await recordAudit({
    childId,
    action: 'create_screen_time_rule',
    target: `screen_time:${childId}`,
    metadata: { daily_limit_min: dailyLimitMin ?? 120, grace_min: graceMin ?? 0, is_enabled: isEnabled ?? true },
  })

  return data
}

// ---------------------------------------------------------------------
// Installed apps
// ---------------------------------------------------------------------

export async function listInstalledApps(childId) {
  // Get devices for this child first, then get installed apps for those devices
  const { data: devices } = await supabase
    .from('pc_devices')
    .select('id')
    .eq('child_id', childId)
  
  if (!devices || devices.length === 0) return []
  
  const deviceIds = devices.map(d => d.id)
  
  const { data, error } = await supabase
    .from('pc_installed_apps')
    .select('*')
    .in('device_id', deviceIds)
    .order('app_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Website rules
// ---------------------------------------------------------------------

export async function listWebsiteRules(childId) {
  const { data, error } = await supabase
    .from('pc_website_rules')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createWebsiteRule({ childId, deviceId, domain, action }) {
  const { data, error } = await supabase
    .from('pc_website_rules')
    .insert({
      child_id: childId,
      device_id: deviceId || null,
      domain: domain.toLowerCase().trim(),
      action,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteWebsiteRule(ruleId) {
  const { error } = await supabase.from('pc_website_rules').delete().eq('id', ruleId)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Child requests (Phase 8)
// ---------------------------------------------------------------------

export async function listChildRequests(childId) {
  const { data, error } = await supabase
    .from('pc_child_requests')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function resolveChildRequest(requestId, { approve, expiresAt }) {
  const { data: userData } = await supabase.auth.getUser()
  const patch = {
    status: approve ? 'approved' : 'denied',
    resolved_by: userData.user.id,
    resolved_at: new Date().toISOString(),
  }
  if (approve && expiresAt) {
    patch.expires_at = expiresAt
  }
  const { data, error } = await supabase.from('pc_child_requests').update(patch).eq('id', requestId).select().single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------

export async function listAuditEvents(childId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('pc_audit_log')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------

export async function listSchedules(childId) {
  const { data, error } = await supabase
    .from('pc_schedules')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createSchedule({ childId, name, daysOfWeek, startTime, endTime, action, alwaysAllowedPackages }) {
  const { data, error } = await supabase
    .from('pc_schedules')
    .insert({
      child_id: childId,
      name,
      days_of_week: daysOfWeek,
      start_time: startTime,
      end_time: endTime,
      action,
      always_allowed_packages: alwaysAllowedPackages || null,
    })
    .select()
    .single()
  if (error) throw error

  await recordAudit({
    childId,
    action: 'create_schedule',
    target: `schedule:${name}`,
    metadata: { days_of_week: daysOfWeek, start_time: startTime, end_time: endTime, action },
  })

  return data
}

export async function updateSchedule(scheduleId, patch) {
  const { error } = await supabase.from('pc_schedules').update(patch).eq('id', scheduleId)
  if (error) throw error
}

export async function deleteSchedule(scheduleId) {
  const { error } = await supabase.from('pc_schedules').delete().eq('id', scheduleId)
  if (error) throw error
}

// ---------------------------------------------------------------------
// App rules
// ---------------------------------------------------------------------

export async function listAppRules(childId) {
  const { data, error } = await supabase
    .from('pc_app_rules')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createAppRule({ childId, deviceId, packageName, appName, action, dailyLimitMin }) {
  const { data, error } = await supabase
    .from('pc_app_rules')
    .insert({
      child_id: childId,
      device_id: deviceId || null,
      package_name: packageName,
      app_name: appName || null,
      action,
      daily_limit_min: action === 'time_limit' ? dailyLimitMin : null,
    })
    .select()
    .single()
  if (error) throw error

  await recordAudit({
    childId,
    deviceId,
    action: 'create_app_rule',
    target: `app:${packageName}`,
    metadata: { action, daily_limit_min: dailyLimitMin },
  })

  return data
}

export async function updateAppRule(ruleId, patch) {
  const { error } = await supabase.from('pc_app_rules').update(patch).eq('id', ruleId)
  if (error) throw error
}

export async function deleteAppRule(ruleId) {
  const { error } = await supabase.from('pc_app_rules').delete().eq('id', ruleId)
  if (error) throw error
  // Audit logging would need childId; skip for now (could fetch first)
}

// Get today's app usage for a child to help parents set time limits
export async function getAppUsageToday(childId) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('pc_app_usage_events')
    .select('*')
    .eq('child_id', childId)
    .eq('usage_date', today)
    .order('total_foreground_ms', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Geofences
// ---------------------------------------------------------------------

export async function listGeofences(childId) {
  const { data, error } = await supabase
    .from('pc_geofences')
    .select('*')
    .eq('child_id', childId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createGeofence({ childId, orgId, name, latitude, longitude, radiusMeters }) {
  const { data, error } = await supabase
    .from('pc_geofences')
    .insert({
      child_id: childId,
      org_id: orgId,
      name,
      latitude,
      longitude,
      radius_meters: radiusMeters || 200,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteGeofence(geofenceId) {
  const { error } = await supabase.from('pc_geofences').delete().eq('id', geofenceId)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------

export async function listAlerts(childId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('pc_alerts')
    .select('*')
    .eq('child_id', childId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function markAlertRead(alertId) {
  const { error } = await supabase.from('pc_alerts').update({ is_read: true }).eq('id', alertId)
  if (error) throw error
}

export function subscribeToAlerts(childId, onInsert) {
  const channel = supabase
    .channel(`pc-alerts-${childId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pc_alerts', filter: `child_id=eq.${childId}` },
      (payload) => onInsert(payload.new),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------

export async function getLatestLocation(childId) {
  const { data, error } = await supabase
    .from('pc_location_events')
    .select('*')
    .eq('child_id', childId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listRecentLocations(childId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('pc_location_events')
    .select('*')
    .eq('child_id', childId)
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// App usage
// ---------------------------------------------------------------------

export async function getTodayUsage(childId) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('pc_app_usage_events')
    .select('*')
    .eq('child_id', childId)
    .eq('usage_date', today)
    .order('total_foreground_ms', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getInstalledApps(deviceIds) {
  const ids = Array.isArray(deviceIds) ? deviceIds : [deviceIds]
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('pc_installed_apps')
    .select('*')
    .in('device_id', ids)
    .order('app_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Device commands (parent -> child)
// ---------------------------------------------------------------------

// How long (ms) before a still-in-flight command is treated as timed out.
// Kept here so the parent stamps expires_at at insert time and the child
// pollers / UI agree on the same window.
export const COMMAND_TIMEOUT_MS = 90_000

export async function sendDeviceCommand({ deviceId, commandType, payload }) {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('pc_device_commands')
    .insert({
      device_id: deviceId,
      command_type: commandType,
      payload: payload || null,
      issued_by: userData.user.id,
      expires_at: new Date(Date.now() + COMMAND_TIMEOUT_MS).toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Recent commands across a set of devices (parent-facing history + live
 * status). RLS (pc_commands_parent_select) already scopes this to the
 * signed-in parent's own devices.
 */
export async function listRecentCommands(deviceIds, { limit = 20 } = {}) {
  const ids = (Array.isArray(deviceIds) ? deviceIds : [deviceIds]).filter(Boolean)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('pc_device_commands')
    .select('*')
    .in('device_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/**
 * Live subscription to command inserts/updates for a set of devices. The
 * child device flips status pending → delivered → executed/failed, and this
 * pushes each change to the parent UI so it can show the TRUE state instead
 * of a premature success toast. Returns an unsubscribe function.
 *
 * Note: Realtime postgres_changes filters accept a single value, so we
 * subscribe per device and fan the callbacks out.
 */
export function subscribeToDeviceCommands(deviceIds, onChange) {
  const ids = (Array.isArray(deviceIds) ? deviceIds : [deviceIds]).filter(Boolean)
  if (ids.length === 0) return () => {}
  const channel = supabase.channel(`pc-commands-${ids.join('-').slice(0, 80)}`)
  for (const id of ids) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pc_device_commands', filter: `device_id=eq.${id}` },
      (payload) => onChange(payload.new ?? payload.old),
    )
  }
  channel.subscribe()
  return () => supabase.removeChannel(channel)
}

/** Move a device to a different child of the same parent. */
export async function reassignDevice(deviceId, newChildId) {
  const { error } = await supabase
    .from('pc_devices')
    .update({ child_id: newChildId })
    .eq('id', deviceId)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Bonus time requests
// ---------------------------------------------------------------------

export async function listBonusRequests(childId) {
  const { data, error } = await supabase
    .from('pc_bonus_time_requests')
    .select('*')
    .eq('child_id', childId)
    .order('requested_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function resolveBonusRequest(requestId, { approve, approvedMin }) {
  const { data: userData } = await supabase.auth.getUser()
  const patch = {
    status: approve ? 'approved' : 'denied',
    resolved_by: userData.user.id,
    resolved_at: new Date().toISOString(),
  }
  if (approve) {
    patch.approved_min = approvedMin
    patch.expires_at = new Date(Date.now() + approvedMin * 60_000).toISOString()
  }
  const { data, error } = await supabase.from('pc_bonus_time_requests').update(patch).eq('id', requestId).select().single()
  if (error) throw error

  if (approve) {
    await sendDeviceCommand({
      deviceId: data.device_id,
      commandType: 'grant_bonus_time',
      payload: { expires_at: patch.expires_at },
    })
  }
  return data
}
