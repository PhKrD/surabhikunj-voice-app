import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { getNativeInfo, onAppResume } from '@/lib/native'
import { logger } from '@/lib/logger'

// Platform remote config (supabase/73_launch_platform.sql →
// app_platform_config). Decides, for an already-installed app, whether it
// must update, should update, or is under maintenance — and carries feature
// flags — all changeable centrally without shipping a new APK.
//
// Fail-open: if the config cannot be fetched (offline, table missing) the
// last known copy is used, and with none the app simply runs. A network
// blip must never lock users out.

const CACHE_KEY = 'platform_config_v1'
const DISMISS_KEY = 'update_banner_dismissed_for'
const REFRESH_MS = 10 * 60 * 1000

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
  } catch {
    return null
  }
}

const useConfigStore = create((set, get) => ({
  platform: readCache(),
  native: { versionCode: null, versionName: null, legacy: false },
  loaded: false,
  lastFetched: 0,

  load: async ({ force = false } = {}) => {
    if (!force && Date.now() - get().lastFetched < 30_000) return
    set({ lastFetched: Date.now() })
    const native = await getNativeInfo()
    set({ native })
    try {
      const query = supabase.from('app_platform_config').select('*').eq('id', 1).maybeSingle()
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
      const { data, error } = await Promise.race([query, timeout])
      if (error) throw error
      if (data) {
        set({ platform: data })
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      }
    } catch (e) {
      logger.debug('[config] using cached platform config:', e?.message)
    } finally {
      set({ loaded: true })
    }
  },

  /** Starts periodic + on-resume refresh. Call once at boot. */
  start: () => {
    get().load({ force: true })
    onAppResume(() => get().load())
    setInterval(() => get().load(), REFRESH_MS)
  },

  dismissRecommended: () => {
    const code = get().platform?.recommended_native_version_code
    if (code) localStorage.setItem(DISMISS_KEY, String(code))
    set({}) // re-render subscribers
  },
}))

/**
 * 'maintenance' | 'update_required' | 'ok', plus whether a newer APK is
 * recommended. Only meaningful in the native app; the web build is always
 * the latest version.
 */
export function selectGate(state) {
  const p = state.platform
  const code = state.native.versionCode
  if (p?.maintenance_enabled) return { status: 'maintenance', recommended: false }
  if (code != null && p?.min_native_version_code && code < p.min_native_version_code) {
    return { status: 'update_required', recommended: false }
  }
  const dismissed = parseInt(localStorage.getItem(DISMISS_KEY) ?? '0', 10)
  const recommended = Boolean(
    code != null &&
      p?.recommended_native_version_code &&
      code < p.recommended_native_version_code &&
      dismissed < p.recommended_native_version_code,
  )
  return { status: 'ok', recommended }
}

export default useConfigStore
