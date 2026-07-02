import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { clearCache } from '@/lib/useCachedQuery'

const DEFAULT_VOICE_ID = import.meta.env.VITE_DEFAULT_VOICE_ID

const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,
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
    } catch {
      // treat any error as signed-out
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
        set({ user: null, profile: null, loginType: 'counsellee' })
      }
    })
  },

  fetchProfile: async (userId) => {
    let { data, error } = await supabase
      .from('profiles')
      .select('*, voices(name, location)')
      .eq('id', userId)
      .single()

    if (!error && data && !data.voice_id && DEFAULT_VOICE_ID) {
      await supabase.rpc('bootstrap_current_user_to_default_voice')

      const refresh = await supabase
        .from('profiles')
        .select('*, voices(name, location)')
        .eq('id', userId)
        .single()

      data = refresh.data
      error = refresh.error
    }

    if (!error && data) {
      set({ user: { id: userId }, profile: data })
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
