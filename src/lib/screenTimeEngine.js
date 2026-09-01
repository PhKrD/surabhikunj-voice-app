/**
 * screenTimeEngine.js
 * Phase 2 — authoritative device-side screen-time enforcement.
 *
 * Reads the child's pc_screen_time_rules, compares the on-device total
 * foreground time (UsageStatsManager) against the daily limit, and locks
 * the device if the limit is exceeded. Respects active bonus time.
 *
 * This is designed to be callable from both the JS command poller and the
 * native background service (VoiceKidsMonitorService) so enforcement still
 * works even when the WebView is suspended.
 */

import { supabase } from './supabase.js'
import { loadDeviceCreds } from './deviceStore.js'
import { dpc } from './dpcPlugin.js'
import { getTodayUsage, hasUsageAccess } from './usageStatsPlugin.js'
import { isBonusActive } from './commandPoller.js'

let lastEnforcementState = null
let deviceOwnerChecked = false
let isDeviceOwner = false

async function checkDeviceOwner() {
  if (deviceOwnerChecked) return isDeviceOwner
  try {
    const result = await dpc.isDeviceOwner()
    isDeviceOwner = result?.isDeviceOwner || false
    deviceOwnerChecked = true
    console.log('[screenTimeEngine] Device Owner status:', isDeviceOwner)
    if (!isDeviceOwner) {
      console.warn('[screenTimeEngine] Device is NOT Device Owner - enforcement will not work')
    }
  } catch (err) {
    console.error('[screenTimeEngine] Failed to check Device Owner status:', err.message)
  }
  return isDeviceOwner
}

/**
 * Returns the screen-time rule for this device's child, or null.
 */
export async function fetchScreenTimeRule(childId) {
  if (!childId) return null
  const { data, error } = await supabase
    .from('pc_screen_time_rules')
    .select('*')
    .eq('child_id', childId)
    .maybeSingle()
  if (error) {
    console.error('[screenTimeEngine] rule fetch failed:', error.message)
    return null
  }
  return data
}

/**
 * Evaluates screen-time state and, if over the daily limit, locks the device.
 * Returns { overLimit, totalMinutes, limitMinutes, locked }.
 */
export async function enforceScreenTime() {
  const creds = loadDeviceCreds()
  if (!creds?.childId || !creds?.deviceId) {
    return { overLimit: false, totalMinutes: 0, limitMinutes: 0, locked: false, reason: 'not_enrolled' }
  }

  // Check Device Owner status first
  const ownerStatus = await checkDeviceOwner()
  if (!ownerStatus) {
    console.warn('[screenTimeEngine] Skipping enforcement - device is not Device Owner')
    return { overLimit: false, totalMinutes: 0, limitMinutes: 0, locked: false, reason: 'not_device_owner' }
  }

  const rule = await fetchScreenTimeRule(creds.childId)
  if (!rule || !rule.is_enabled || rule.daily_limit_min <= 0) {
    return { overLimit: false, totalMinutes: 0, limitMinutes: 0, locked: false, reason: 'no_rule' }
  }

  const { granted } = await hasUsageAccess()
  if (!granted) {
    return { overLimit: false, totalMinutes: 0, limitMinutes: rule.daily_limit_min, locked: false, reason: 'no_usage_permission' }
  }

  const { totalForegroundMinutes } = await getTodayUsage()
  const total = totalForegroundMinutes ?? 0
  const limit = rule.daily_limit_min + (rule.grace_min ?? 0)

  if (isBonusActive()) {
    return { overLimit: false, totalMinutes: total, limitMinutes: limit, locked: false, reason: 'bonus_active' }
  }

  const overLimit = total >= limit
  if (overLimit) {
    if (lastEnforcementState !== 'locked') {
      console.log('[screenTimeEngine] Daily limit exceeded, locking device')
      const result = await dpc.lockDevice()
      lastEnforcementState = 'locked'
      await reportScreenTimeAlert(creds, total, limit)
      return { overLimit: true, totalMinutes: total, limitMinutes: limit, locked: result.success, result }
    }
  } else {
    lastEnforcementState = null
  }

  return { overLimit, totalMinutes: total, limitMinutes: limit, locked: lastEnforcementState === 'locked' }
}

async function reportScreenTimeAlert(creds, totalMinutes, limitMinutes) {
  try {
    await supabase.from('pc_alerts').insert({
      child_id: creds.childId,
      device_id: creds.deviceId,
      alert_type: 'screen_time_exceeded',
      severity: 'warning',
      title: 'Daily screen-time limit reached',
      body: `${totalMinutes} minutes used out of ${limitMinutes} minute limit.`,
      metadata: { total_minutes: totalMinutes, limit_minutes: limitMinutes },
    })
  } catch (err) {
    console.warn('[screenTimeEngine] alert insert failed:', err?.message)
  }
}

/**
 * Resets enforcement state (e.g. after midnight or bonus granted).
 */
export function resetScreenTimeEnforcement() {
  lastEnforcementState = null
  deviceOwnerChecked = false
  isDeviceOwner = false
}
