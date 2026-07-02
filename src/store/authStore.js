import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { clearCache } from '@/lib/useCachedQuery'
import { getWithFallback, saveProfileOffline } from '@/lib/offlineDatabase'

const DEFAULT_VOICE_ID = import.meta.env.VITE_DEFAULT_VOICE_ID

// --- localStorage profile cache (synchronous, survives Supabase outages) ---
const LS_KEY = (uid) => `profile_cache:${uid}`

function readProfileCache(uid) {
  try {
    const raw = localStorage.getItem(LS_KEY(uid))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeProfileCache(profile) {
  try {
    localStorage.setItem(LS_KEY(profile.id), JSON.stringify(profile))
  } catch { /* quota exceeded – ignore */ }
}

function clearProfileCache(uid) {
  try { localStorage.removeItem(LS_KEY(uid)) } catch { }
}

const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  profileLoading: false,
  profileError: null,
  initialized: false,
  loginType: localStorage.getItem('loginType') || 'counsellee',

  setLoginType: (type) => {
    localStorage.setItem('loginType', type)
    set({ loginType: type })
  },

  initialize: async () => {
    // Race getSession against a timeout so a hung token-refresh never blocks the UI
    let session = null
    try {
      const timeout = new Promise((resolve) => setTimeout(resolve, 4000))
      const sessionResult = supabase.auth.getSession().then((r) => r.data.session)
      session = await Promise.race([sessionResult, timeout])
    } catch (e) {
      console.error('[auth] getSession failed:', e)
    }

    // Immediately seed profile from localStorage so Dashboard renders right away
    const cachedProfile = session?.user ? readProfileCache(session.user.id) : null

    set({
      user: session?.user ?? null,
      profile: cachedProfile ?? null,
      loading: false,
      initialized: true,
    })

    if (session?.user) {
      get().fetchProfile(session.user.id)
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        set({ user: session.user })
        get().fetchProfile(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem('loginType')
        clearCache()
        set({ user: null, profile: null, profileError: null, loginType: 'counsellee' })
      }
    })
  },

  fetchProfile: async (userId) => {
    // If we already have a cached profile, don't show loading — refresh silently
    const hasCached = !!readProfileCache(userId)
    if (!hasCached) set({ profileLoading: true, profileError: null })

    try {
      let data = await getWithFallback(
        `profile:${userId}`,
        async () => {
          const { data, error } = await supabase
            .from('profiles')
            .select('*, voices(name, location)')
            .eq('id', userId)
            .single()
          if (error) throw error
          return data
        },
        24 * 60 * 60 * 1000
      )

      if (data && !data.voice_id && DEFAULT_VOICE_ID) {
        try {
          await supabase.rpc('bootstrap_current_user_to_default_voice')
        } catch (rpcError) {
          console.error('[auth] bootstrap RPC failed:', rpcError)
        }

        const refresh = await supabase
          .from('profiles')
          .select('*, voices(name, location)')
          .eq('id', userId)
          .single()

        if (refresh.error) throw refresh.error
        data = refresh.data
      }

      if (data) {
        // Save to localStorage so next visit is instant
        writeProfileCache(data)
        await saveProfileOffline(data)
        set({ user: { id: userId }, profile: data, profileError: null })
      } else {
        throw new Error('Profile not found')
      }
    } catch (error) {
      console.error('[auth] fetchProfile failed:', error)
      // If we have a cached profile, stay silent — user can still use the app
      const cached = readProfileCache(userId)
      if (cached) {
        console.log('[auth] Using localStorage cache due to fetch failure')
        set({ profile: cached, profileError: null })
      } else {
        set({ profileError: error.message || 'Failed to load profile' })
      }
    } finally {
      set({ profileLoading: false })
    }
  },

  signInWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signUpWithEmail: async (email, password, spiritualName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { spiritual_name: spiritualName } },
    })
    if (error) throw error
    return data
  },

  signOut: async () => {
    const { profile } = get()
    if (profile?.id) clearProfileCache(profile.id)
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      console.error('Sign out failed:', error.message)
    }
    set({ user: null, profile: null })
    return { error }
  },

  updateProfile: async (updates) => {
    const { profile } = get()
    if (!profile) return
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)
      .select()
      .single()
    if (!error && data) set({ profile: data })
    return { data, error }
  },
}))

export default useAuthStore
