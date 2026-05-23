import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

const DEFAULT_VOICE_ID = import.meta.env.VITE_DEFAULT_VOICE_ID

const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  initialized: false,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await get().fetchProfile(session.user.id)
    }
    set({ loading: false, initialized: true })

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        set({ user: session.user })
        await get().fetchProfile(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        set({ user: null, profile: null })
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
