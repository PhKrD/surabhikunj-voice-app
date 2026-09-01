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
