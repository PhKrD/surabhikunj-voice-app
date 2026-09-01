/**
 * usageStatsPlugin.js
 * JS bridge to the native VoiceKidsUsageStatsPlugin — used only for the
 * child's own "Screen time today" widget. Periodic reporting to
 * pc_app_usage_events / pc_installed_apps happens natively in
 * VoiceKidsMonitorService regardless of whether this is ever called.
 */

import { registerPlugin } from '@capacitor/core'

const NativeUsageStats = registerPlugin('VoiceKidsUsageStats')

const isNative = () => {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

export async function hasUsageAccess() {
  if (!isNative()) return { granted: false }
  return NativeUsageStats.hasUsageAccess()
}

export async function openUsageAccessSettings() {
  if (!isNative()) return { success: false, reason: 'web_platform' }
  return NativeUsageStats.openUsageAccessSettings()
}

/** Returns { totalForegroundMs, totalForegroundMinutes, apps: [...] } for today so far. */
export async function getTodayUsage() {
  if (!isNative()) return { totalForegroundMs: 0, totalForegroundMinutes: 0, apps: [] }
  return NativeUsageStats.getTodayUsage()
}

/** Force sync installed apps to Supabase immediately (bypasses 24h interval). */
export async function syncInstalledApps() {
  if (!isNative()) return { success: false, reason: 'web_platform' }
  return NativeUsageStats.syncInstalledApps()
}

/**
 * Returns { packages: string[] } — every installed package name, used by
 * ruleEngine.js's full-reconcile sweep. Resolves { packages: [] } on web so
 * callers can treat "no data" uniformly instead of special-casing platform.
 */
export async function getInstalledPackages() {
  if (!isNative()) return { packages: [] }
  return NativeUsageStats.getInstalledPackages()
}
