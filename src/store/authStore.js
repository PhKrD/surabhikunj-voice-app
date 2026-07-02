import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { clearCache } from '@/lib/useCachedQuery'

const DEFAULT_VOICE_ID = import.meta.env.VITE_DEFAULT_VOICE_ID

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
    // Unblock the UI as soon as the auth state is known (getSession reads
    // from local storage and is fast). The profile is hydrated in the
    // background so the app shell paints immediately instead of waiting on
    // a network round-trip.
    set({ user: session?.user ?? null, loading: false, initialized: true })
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
    set({ profileLoading: true, profileError: null })
    try {
      // Add a hard timeout so a hung network request cannot leave the UI stuck
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Profile fetch timed out')), 10000)
      )

      const query = supabase
        .from('profiles')
        .select('*, voices(name, location)')
        .eq('id', userId)
        .single()

      let { data, error } = await Promise.race([query, timeout])

      if (error) throw error

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
        set({ user: { id: userId }, profile: data, profileError: null })
      } else {
        throw new Error('Profile not found')
      }
    } catch (error) {
      console.error('[auth] fetchProfile failed:', error)
      set({ profileError: error.message || 'Failed to load profile' })
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
