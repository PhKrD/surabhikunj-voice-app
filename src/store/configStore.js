import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '@/lib/supabase'
import { getNativeInfo, onAppResume } from '@/lib/native'
import { logger } from '@/lib/logger'
import { computeGate } from '@/lib/updateGate'

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
  /** Platform admins edit this config and are never locked out by it. */
  isPlatformAdmin: false,
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
      const { data: session } = await supabase.auth.getSession()
      if (session?.session) {
        const { data: admin } = await supabase.rpc('is_platform_admin')
        set({ isPlatformAdmin: admin === true })
      } else {
        set({ isPlatformAdmin: false })
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
  return computeGate(state.platform, state.native.versionCode, {
    isPlatformAdmin: state.isPlatformAdmin,
    dismissedFor: parseInt(localStorage.getItem(DISMISS_KEY) ?? '0', 10) || 0,
  })
}

/**
 * Hook form of selectGate. useShallow is required: selectGate builds a new
 * object each call, and zustand v5 re-renders on every new reference — an
 * infinite render loop without it.
 */
export function useGate() {
  return useConfigStore(useShallow(selectGate))
}

export default useConfigStore
