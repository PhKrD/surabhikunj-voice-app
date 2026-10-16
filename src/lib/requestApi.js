/**
 * requestApi.js
 * Phase 8 — Child requests for bonus time, app unblock, website access, etc.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'

export async function createRequest({ type, metadata, reason }) {
  const creds = loadDeviceCreds()
  if (!creds?.childId || !creds?.deviceId) throw new Error('Not enrolled')

  const { data, error } = await supabase
    .from('pc_child_requests')
    .insert({
      child_id: creds.childId,
      device_id: creds.deviceId,
      request_type: type,
      metadata: metadata || null,
      reason: reason || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Apps the parent has blocked or time-limited for this child — what the
 * child can pick from when asking for an app. Picking one sends the exact
 * package_name, so the parent's "Approve" can apply the change itself
 * (resolveChildRequest) instead of the parent having to guess from text.
 */
export async function listRestrictedApps() {
  const creds = loadDeviceCreds()
  if (!creds?.childId) return []
  const { data, error } = await supabase
    .from('pc_app_rules')
    .select('package_name, app_name, action')
    .eq('child_id', creds.childId)
    .in('action', ['block', 'time_limit'])
  if (error) throw error
  const seen = new Set()
  return (data ?? [])
    .filter((r) => r.package_name && !seen.has(r.package_name) && seen.add(r.package_name))
    .map((r) => ({ packageName: r.package_name, appName: r.app_name || r.package_name, action: r.action }))
    .sort((a, b) => a.appName.localeCompare(b.appName))
}

export async function listMyRequests() {
  const creds = loadDeviceCreds()
  if (!creds?.childId) return []

  const { data, error } = await supabase
    .from('pc_child_requests')
    .select('*')
    .eq('child_id', creds.childId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
