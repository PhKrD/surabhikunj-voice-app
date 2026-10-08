import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { getNativeInfo, hasPlugin, isNative, onAppResume } from '@/lib/native'
import { compareVersions } from '@/lib/appVersion'
import { logger } from '@/lib/logger'

// Over-the-air updates for the web layer (all screens, logic and styles).
//
// Manifest (published by scripts/deploy-ota.mjs to Supabase Storage):
//   {
//     "version": "0.1.0",
//     "url": "https://…/bundles/0.1.0.zip",
//     "minNativeVersionCode": 3   // oldest APK this JS supports
//   }
//
// Safety rules:
//  1. A bundle is only installed on an APK at least `minNativeVersionCode`,
//     so JS that needs a newer native layer never reaches an APK that lacks
//     it. That APK keeps its current bundle; the remote config tells the
//     user to install the new APK.
//  2. The new bundle is applied on the NEXT launch, never mid-session.
//  3. The bundle is marked healthy only after the app has actually rendered
//     (markBundleHealthy, from App.jsx). If a new bundle crashes before
//     that, the updater rolls back to the previous one automatically.

const OTA_BASE = import.meta.env.VITE_OTA_BASE_URL?.replace(/\/$/, '')
const CHECK_INTERVAL_MS = 30 * 60 * 1000

let checking = false
let lastCheck = 0

async function checkForUpdate() {
  if (checking || Date.now() - lastCheck < CHECK_INTERVAL_MS) return
  checking = true
  lastCheck = Date.now()
  try {
    const res = await fetch(`${OTA_BASE}/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const manifest = await res.json()
    if (!manifest?.version || !manifest?.url) return

    const native = await getNativeInfo()
    const required = Number(manifest.minNativeVersionCode ?? 0)
    if (required && (native.versionCode ?? 0) < required) {
      logger.debug(`[ota] ${manifest.version} needs APK build ${required}; installed ${native.versionCode}`)
      return
    }

    const current = await CapacitorUpdater.current()
    const currentVersion = current?.bundle?.version
    // Equal = nothing to do. Different (including lower) = install: publishing
    // an older version is how a bad release is rolled back.
    if (currentVersion && compareVersions(manifest.version, currentVersion) === 0) return

    // Already downloaded earlier and waiting for the next launch?
    const { bundles } = await CapacitorUpdater.list()
    const existing = bundles?.find((b) => b.version === manifest.version && b.status !== 'error')
    const bundle = existing ?? (await CapacitorUpdater.download({ url: manifest.url, version: manifest.version }))
    await CapacitorUpdater.next({ id: bundle.id })
    logger.debug(`[ota] ${manifest.version} ready; applies on next launch`)
  } catch (e) {
    // Network/parse failure: keep the current bundle, retry later.
    logger.debug('[ota] check failed:', e?.message)
  } finally {
    checking = false
  }
}

export async function initLiveUpdates() {
  if (!isNative || !OTA_BASE || !hasPlugin('CapacitorUpdater')) return
  checkForUpdate()
  // Long sessions also pick up releases: check again when the app returns
  // to the foreground (throttled to every 30 minutes).
  onAppResume(checkForUpdate)
}

/** Confirms the running bundle works. Called after the first real render. */
export async function markBundleHealthy() {
  if (!hasPlugin('CapacitorUpdater')) return
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    // Not running inside the native shell.
  }
}
