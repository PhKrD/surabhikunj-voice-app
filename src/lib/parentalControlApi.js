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

export async function createChild({ orgId, displayName, dateOfBirth, ageGroup, linkedProfileId }) {
  const { data, error } = await supabase
    .from('pc_children')
    .insert({
      org_id: orgId,
      parent_id: (await supabase.auth.getUser()).data.user.id,
      display_name: displayName,
      date_of_birth: dateOfBirth || null,
      age_group: ageGroup || null,
      linked_profile_id: linkedProfileId || null,
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
  const { data: device } = await supabase
    .from('pc_devices')
    .select('child_id, device_name')
    .eq('id', deviceId)
    .maybeSingle()

  const { error } = await supabase.from('pc_devices').delete().eq('id', deviceId)
  if (error) throw error

  if (device) {
    await recordAudit({
      childId: device.child_id,
      deviceId,
      action: 'remove_device',
      target: `device:${device.device_name || deviceId}`,
    })
  }
}

export async function renameDevice(deviceId, deviceName) {
  const { data: device } = await supabase
    .from('pc_devices')
    .select('child_id')
    .eq('id', deviceId)
    .maybeSingle()

  const { error } = await supabase.from('pc_devices').update({ device_name: deviceName }).eq('id', deviceId)
  if (error) throw error

  if (device) {
    await recordAudit({
      childId: device.child_id,
      deviceId,
      action: 'rename_device',
      target: `device:${deviceName}`,
    })
  }
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

/**
 * Creates/updates the child's daily screen-time rule.
 *  - dailyLimitMin      fallback limit for days without an override
 *  - dailyLimitsByDow   optional { "0": 120, ..., "6": 180 } per-weekday
 *                       minutes (JS getDay(); migration 70)
 *  - limitAction        'lock_navigation' | 'lock_device' | 'alert_only'
 *  - alertOnLimit       notify the parent when the limit is reached
 * Columns from migration 70 are only sent when provided so a pre-70 DB
 * keeps working.
 */
export async function upsertScreenTimeRule({
  childId, orgId, dailyLimitMin, graceMin, isEnabled, dailyLimitsByDow, limitAction, alertOnLimit,
}) {
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
  if (dailyLimitsByDow !== undefined) payload.daily_limits_by_dow = dailyLimitsByDow
  if (limitAction !== undefined) payload.limit_action = limitAction
  if (alertOnLimit !== undefined) payload.alert_on_limit = alertOnLimit

  const query = existing?.id
    ? supabase.from('pc_screen_time_rules').update(payload).eq('id', existing.id)
    : supabase.from('pc_screen_time_rules').insert(payload)
  const { data, error } = await query.select().single()
  if (error) throw error

  await recordAudit({
    childId,
    action: existing?.id ? 'update_screen_time_rule' : 'create_screen_time_rule',
    target: `screen_time:${childId}`,
    metadata: payload,
  })

  return data
}

// ---------------------------------------------------------------------
// Restricted times (Qustodio-style weekly hour grid — migration 70)
// ---------------------------------------------------------------------

export async function getRestrictedTimes(childId) {
  const { data, error } = await supabase
    .from('pc_restricted_times')
    .select('*')
    .eq('child_id', childId)
    .maybeSingle()
  if (error) throw error
  return data ?? { child_id: childId, cells: {}, action: 'lock_navigation', is_enabled: true }
}

/** cells: { "0": [22, 23], ... } hours (0-23) per JS weekday during which the device is restricted. */
export async function upsertRestrictedTimes({ childId, cells, action, isEnabled }) {
  const { data, error } = await supabase
    .from('pc_restricted_times')
    .upsert(
      { child_id: childId, cells: cells ?? {}, action: action ?? 'lock_navigation', is_enabled: isEnabled ?? true },
      { onConflict: 'child_id' },
    )
    .select()
    .single()
  if (error) throw error

  await recordAudit({
    childId,
    action: 'update_restricted_times',
    target: `restricted_times:${childId}`,
    metadata: { action: action ?? 'lock_navigation', is_enabled: isEnabled ?? true, hours: Object.values(cells ?? {}).reduce((n, h) => n + h.length, 0) },
  })
  return data
}

// ---------------------------------------------------------------------
// Screen-time history (for the Summary / Screen Time charts)
// ---------------------------------------------------------------------

/** Per-day total foreground ms for the last `days` days (oldest first), zero-filled. */
export async function getUsageHistory(childId, { days = 7 } = {}) {
  const start = new Date()
  start.setDate(start.getDate() - (days - 1))
  const startIso = start.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('pc_app_usage_events')
    .select('usage_date, package_name, app_name, total_foreground_ms')
    .eq('child_id', childId)
    .gte('usage_date', startIso)
  if (error) throw error

  const byDate = {}
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    byDate[d.toISOString().slice(0, 10)] = { date: d.toISOString().slice(0, 10), totalMs: 0, apps: {} }
  }
  for (const row of data ?? []) {
    const bucket = byDate[row.usage_date]
    if (!bucket) continue
    bucket.totalMs += row.total_foreground_ms || 0
    bucket.apps[row.package_name] = {
      name: row.app_name || row.package_name,
      ms: (bucket.apps[row.package_name]?.ms ?? 0) + (row.total_foreground_ms || 0),
    }
  }
  return Object.values(byDate)
}

/** Grants bonus/extra time directly (no child request needed) to every active device of the child. */
export async function grantExtraTime(childId, minutes) {
  const devices = await listDevices(childId)
  const active = devices.filter((d) => d.is_active)
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString()
  await Promise.all(
    active.map((d) => sendDeviceCommand({ deviceId: d.id, commandType: 'grant_bonus_time', payload: { expires_at: expiresAt, minutes } })),
  )
  await recordAudit({ childId, action: 'grant_extra_time', target: `bonus:${childId}`, metadata: { minutes, expires_at: expiresAt } })
  return { expiresAt, devices: active.length }
}

/** Revokes any active bonus/extra time on every active device of the child. */
export async function revokeExtraTime(childId) {
  const devices = await listDevices(childId)
  const active = devices.filter((d) => d.is_active)
  await Promise.all(active.map((d) => sendDeviceCommand({ deviceId: d.id, commandType: 'revoke_bonus_time' })))
  await recordAudit({ childId, action: 'revoke_extra_time', target: `bonus:${childId}` })
  return { devices: active.length }
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

  await recordAudit({
    childId,
    deviceId,
    action: 'create_website_rule',
    target: `website:${data.domain}`,
    metadata: { action },
  })

  return data
}

// ---------------------------------------------------------------------
// Website filtering — categories + settings (see src/lib/webCategories.js)
// ---------------------------------------------------------------------

export async function listCategoryRules(childId) {
  const { data, error } = await supabase
    .from('pc_website_category_rules')
    .select('*')
    .eq('child_id', childId)
  if (error) throw error
  return data ?? []
}

/** Upserts the allow/block action for one category. Deletes the row if action is null (falls back to the category's own default). */
export async function setCategoryRule({ childId, categoryKey, action }) {
  if (!action) {
    const { error } = await supabase
      .from('pc_website_category_rules')
      .delete()
      .eq('child_id', childId)
      .eq('category_key', categoryKey)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('pc_website_category_rules')
    .upsert({ child_id: childId, category_key: categoryKey, action }, { onConflict: 'child_id,category_key' })
    .select()
    .single()
  if (error) throw error
  return data
}

const DEFAULT_FILTER_SETTINGS = {
  apply_filters: true,
  block_unsupported_browsers: false,
  block_unknown_websites: false,
  enforce_safe_search: false,
  alert_on_block: true,
}

export async function getWebsiteFilterSettings(childId) {
  const { data, error } = await supabase
    .from('pc_website_filter_settings')
    .select('*')
    .eq('child_id', childId)
    .maybeSingle()
  if (error) throw error
  return data ?? { child_id: childId, ...DEFAULT_FILTER_SETTINGS }
}

export async function updateWebsiteFilterSettings(childId, patch) {
  const current = await getWebsiteFilterSettings(childId)
  const { data, error } = await supabase
    .from('pc_website_filter_settings')
    .upsert({ ...current, child_id: childId, ...patch }, { onConflict: 'child_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteWebsiteRule(ruleId) {
  const { data: rule } = await supabase
    .from('pc_website_rules')
    .select('child_id, device_id, domain')
    .eq('id', ruleId)
    .maybeSingle()

  const { error } = await supabase.from('pc_website_rules').delete().eq('id', ruleId)
  if (error) throw error

  if (rule) {
    await recordAudit({
      childId: rule.child_id,
      deviceId: rule.device_id,
      action: 'delete_website_rule',
      target: `website:${rule.domain}`,
    })
  }
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

/**
 * Resolves a generic child request (pc_child_requests).
 *
 * IMPORTANT — only `bonus_time` actually changes anything on the device:
 * it sends a real `grant_bonus_time` command, mirroring resolveBonusRequest().
 * `app_unblock` / `website_access` / `schedule_exception` requests are
 * freeform text on the child side (RequestPage.jsx never captures a
 * structured package name or domain), so approving them can only update
 * the request's status — there is nothing to safely automate without
 * guessing intent from free text. The UI (RequestsTab.jsx) discloses this
 * so parents don't think approval alone changes the device; they still
 * need to go make the matching change in Rules / Website Rules.
 */
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
  const { data, error } = await supabase
    .from('pc_child_requests')
    .update(patch)
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error

  if (approve && data.request_type === 'bonus_time' && data.device_id && expiresAt) {
    await sendDeviceCommand({
      deviceId: data.device_id,
      commandType: 'grant_bonus_time',
      payload: { expires_at: expiresAt },
    })
  }

  await recordAudit({
    childId: data.child_id,
    deviceId: data.device_id,
    action: approve ? 'approve_child_request' : 'deny_child_request',
    target: `request:${data.request_type}`,
    metadata: { request_type: data.request_type, reason: data.reason },
  })

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
  const { data: schedule, error } = await supabase
    .from('pc_schedules')
    .update(patch)
    .eq('id', scheduleId)
    .select('child_id, device_id, name')
    .single()
  if (error) throw error

  await recordAudit({
    childId: schedule.child_id,
    deviceId: schedule.device_id,
    action: 'update_schedule',
    target: `schedule:${schedule.name}`,
    metadata: patch,
  })
}

export async function deleteSchedule(scheduleId) {
  const { data: schedule } = await supabase
    .from('pc_schedules')
    .select('child_id, device_id, name')
    .eq('id', scheduleId)
    .maybeSingle()

  const { error } = await supabase.from('pc_schedules').delete().eq('id', scheduleId)
  if (error) throw error

  if (schedule) {
    await recordAudit({
      childId: schedule.child_id,
      deviceId: schedule.device_id,
      action: 'delete_schedule',
      target: `schedule:${schedule.name}`,
    })
  }
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

export async function createAppRule({ childId, deviceId, packageName, appName, action, dailyLimitMin, dailyLimitsByDow, alertOnUse }) {
  const row = {
    child_id: childId,
    device_id: deviceId || null,
    package_name: packageName,
    app_name: appName || null,
    action,
    daily_limit_min: action === 'time_limit' ? dailyLimitMin : null,
  }
  // Migration-70 columns — only sent when the caller provides them so a
  // pre-70 database keeps accepting plain rules.
  if (dailyLimitsByDow !== undefined) row.daily_limits_by_dow = action === 'time_limit' ? dailyLimitsByDow : null
  if (alertOnUse !== undefined) row.alert_on_use = Boolean(alertOnUse)

  const { data, error } = await supabase.from('pc_app_rules').insert(row).select().single()
  if (error) throw error

  await recordAudit({
    childId,
    deviceId,
    action: 'create_app_rule',
    target: `app:${packageName}`,
    metadata: { action, daily_limit_min: dailyLimitMin, alert_on_use: alertOnUse ?? false },
  })

  return data
}

export async function updateAppRule(ruleId, patch) {
  const { data, error } = await supabase.from('pc_app_rules').update(patch).eq('id', ruleId).select().single()
  if (error) throw error
  await recordAudit({
    childId: data.child_id,
    deviceId: data.device_id,
    action: 'update_app_rule',
    target: `app:${data.package_name}`,
    metadata: patch,
  })
  return data
}

/**
 * Qustodio-style "set this app to Allowed / Blocked / Time limit / alert":
 * upserts the child-wide rule for a package, or deletes it when `action`
 * is null (back to "no rule" = allowed by default, no alert).
 */
export async function setAppRule({ childId, packageName, appName, action, dailyLimitMin, dailyLimitsByDow, alertOnUse }) {
  const { data: existing } = await supabase
    .from('pc_app_rules')
    .select('id')
    .eq('child_id', childId)
    .eq('package_name', packageName)
    .is('device_id', null)
    .maybeSingle()

  // "Allowed" is the default state — an allow rule without an alert flag is
  // the same as no rule at all, so drop the row instead of keeping noise.
  if ((!action || action === 'allow') && !alertOnUse) {
    if (existing?.id) await deleteAppRule(existing.id)
    return null
  }

  const resolvedAction = action ?? 'allow'
  if (existing?.id) {
    const patch = {
      action: resolvedAction,
      app_name: appName || null,
      daily_limit_min: resolvedAction === 'time_limit' ? dailyLimitMin ?? 60 : null,
    }
    if (dailyLimitsByDow !== undefined) patch.daily_limits_by_dow = resolvedAction === 'time_limit' ? dailyLimitsByDow : null
    if (alertOnUse !== undefined) patch.alert_on_use = Boolean(alertOnUse)
    return updateAppRule(existing.id, patch)
  }
  return createAppRule({ childId, packageName, appName, action: resolvedAction, dailyLimitMin: dailyLimitMin ?? 60, dailyLimitsByDow, alertOnUse })
}

export async function deleteAppRule(ruleId) {
  const { data: rule } = await supabase
    .from('pc_app_rules')
    .select('child_id, device_id, package_name')
    .eq('id', ruleId)
    .maybeSingle()

  const { error } = await supabase.from('pc_app_rules').delete().eq('id', ruleId)
  if (error) throw error

  if (rule) {
    await recordAudit({
      childId: rule.child_id,
      deviceId: rule.device_id,
      action: 'delete_app_rule',
      target: `app:${rule.package_name}`,
    })
  }
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
// Web activity (best-effort, AccessibilityService-based — see
// PLATFORM_LIMITATIONS.md and VoiceKidsAccessibilityService.kt's doc
// comment before treating this as an exhaustive browsing log)
// ---------------------------------------------------------------------

export async function listWebActivity(childId, { limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('pc_web_activity')
    .select('*')
    .eq('child_id', childId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export function subscribeToWebActivity(childId, onInsert) {
  const channel = supabase
    .channel(`pc-web-activity-${childId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pc_web_activity', filter: `child_id=eq.${childId}` },
      (payload) => onInsert(payload.new),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
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

  await recordAudit({
    childId: newChildId,
    deviceId,
    action: 'reassign_device',
    target: `device:${deviceId}`,
  })
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

  await recordAudit({
    childId: data.child_id,
    deviceId: data.device_id,
    action: approve ? 'approve_bonus_time' : 'deny_bonus_time',
    target: `bonus:${requestId}`,
    metadata: { approved_min: approve ? approvedMin : null },
  })

  return data
}
