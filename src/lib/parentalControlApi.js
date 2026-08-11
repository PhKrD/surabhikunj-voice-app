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
  const { data, error } = await supabase
    .from('pc_devices')
    .select('*')
    .eq('child_id', childId)
    .order('created_at')
  if (error) throw error
  return data ?? []
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
  return data
}

export async function updateAppRule(ruleId, patch) {
  const { error } = await supabase.from('pc_app_rules').update(patch).eq('id', ruleId)
  if (error) throw error
}

export async function deleteAppRule(ruleId) {
  const { error } = await supabase.from('pc_app_rules').delete().eq('id', ruleId)
  if (error) throw error
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

// ---------------------------------------------------------------------
// Device commands (parent -> child)
// ---------------------------------------------------------------------

export async function sendDeviceCommand({ deviceId, commandType, payload }) {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('pc_device_commands')
    .insert({
      device_id: deviceId,
      command_type: commandType,
      payload: payload || null,
      issued_by: userData.user.id,
    })
    .select()
    .single()
  if (error) throw error
  return data
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
