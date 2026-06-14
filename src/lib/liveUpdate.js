import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

// Base public URL of the Supabase Storage bucket that holds OTA bundles, e.g.
//   https://<ref>.supabase.co/storage/v1/object/public/app-bundles
// Set via VITE_OTA_BASE_URL in .env. If unset, OTA is disabled (web/dev).
const OTA_BASE = import.meta.env.VITE_OTA_BASE_URL?.replace(/\/$/, '')

/**
 * Initialise the live-update system.
 * - Always calls notifyAppReady() so the plugin marks the running bundle as
 *   good (otherwise capgo auto-rolls back after a timeout).
 * - On native platforms, checks version.json on Supabase Storage and, if a
 *   newer bundle exists, downloads it and schedules it for the NEXT launch
 *   (non-disruptive — no mid-session reload).
 */
export async function initLiveUpdates() {
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    // Not running inside a Capacitor native shell — ignore.
  }

  if (!Capacitor.isNativePlatform() || !OTA_BASE) return

  try {
    const res = await fetch(`${OTA_BASE}/version.json?t=${Date.now()}`)
    if (!res.ok) return
    const manifest = await res.json()
    if (!manifest?.version || !manifest?.url) return

    const current = await CapacitorUpdater.current()
    if (manifest.version === current?.bundle?.version) return

    const bundle = await CapacitorUpdater.download({
      url: manifest.url,
      version: manifest.version,
    })
    // Activate on next app start to avoid interrupting the current session.
    await CapacitorUpdater.next(bundle)
  } catch {
    // Network/parse failure — keep the current bundle, try again next launch.
  }
}
