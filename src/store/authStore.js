import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { clearCache } from '@/lib/useCachedQuery'
import { logger } from '@/lib/logger'

// Roles that imply a mentorship/counsellor view by default
const MENTOR_ROLES = ['counsellor', 'sadhana_incharge', 'admin', 'vmc', 'oc']

// --- Last-known profile (synchronous, so the app renders instantly and keeps
// working offline). Always refreshed from the server when reachable. ---
const LS_KEY = (uid) => `profile_cache:${uid}`

function readProfileCache(uid) {
  try {
    const raw = localStorage.getItem(LS_KEY(uid))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeProfileCache(profile) {
  try {
    localStorage.setItem(LS_KEY(profile.id), JSON.stringify(profile))
  } catch {
    // Storage full: the app still works, it just won't start offline.
  }
}

function clearProfileCache(uid) {
  try {
    localStorage.removeItem(LS_KEY(uid))
  } catch {
    // Nothing to clear.
  }
}

function withDisplayName(profile) {
  return { ...profile, display_name: profile.spiritual_name || profile.legal_name || profile.email }
}

/**
 * Where password-reset emails send people. Inside the native app
 * window.location.origin is the app's internal origin (https://localhost),
 * which a link in an email cannot open — so the hosted web app is used.
 */
function resetRedirectUrl() {
  const base = import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin
  return `${base.replace(/\/$/, '')}/reset-password`
}

let listenerInstalled = false
// Distinguishes "the user pressed Sign out" from "the session ended on its
// own" (refresh token revoked/expired), which deserves an explanation.
let userInitiatedSignOut = false

const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  profileLoading: false,
  profileError: null,
  initialized: false,
  /** True after opening a password-reset link: show the new-password form. */
  passwordRecovery: false,
  /** Set when the session ended without the user signing out. */
  sessionExpired: false,
  loginType: localStorage.getItem('loginType') || 'counsellee',

  setLoginType: (type) => {
    localStorage.setItem('loginType', type)
    set({ loginType: type })
  },

  initialize: async () => {
    if (get().initialized) return
    get()._installListener()

    // Race getSession against a timeout so a hung token refresh never blocks the UI.
    let session = null
    try {
      const timeout = new Promise((resolve) => setTimeout(resolve, 4000))
      const sessionResult = supabase.auth.getSession().then((r) => r.data.session)
      session = await Promise.race([sessionResult, timeout])
    } catch (e) {
      logger.warn('[auth] getSession failed:', e)
    }

    const cachedProfile = session?.user ? readProfileCache(session.user.id) : null
    set({
      user: session?.user ?? null,
      profile: cachedProfile,
      loading: false,
      initialized: true,
    })

    if (session?.user) await get()._afterSignIn(session.user.id)
  },

  /**
   * Supabase warns that awaiting other Supabase calls inside this callback can
   * deadlock the auth lock, so all follow-up work is deferred with
   * setTimeout. The callback itself only records state.
   */
  _installListener: () => {
    if (listenerInstalled) return
    listenerInstalled = true
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        set({ passwordRecovery: true, user: session?.user ?? null })
        return
      }
      if (event === 'SIGNED_IN' && session?.user) {
        const isNewUser = get().user?.id !== session.user.id
        set({ user: session.user, sessionExpired: false })
        if (isNewUser) setTimeout(() => get()._afterSignIn(session.user.id), 0)
        return
      }
      if (event === 'SIGNED_OUT') {
        const expired = !userInitiatedSignOut && Boolean(get().user)
        userInitiatedSignOut = false
        setTimeout(() => get()._resetLocalState({ expired }), 0)
      }
    })
  },

  _afterSignIn: async (userId) => {
    await get().fetchProfile(userId)
    const { default: useOrgStore } = await import('@/store/orgStore')
    useOrgStore.getState().initialize()
  },

  _resetLocalState: async ({ expired = false } = {}) => {
    const uid = get().user?.id
    if (uid) clearProfileCache(uid)
    localStorage.removeItem('loginType')
    clearCache()
    const { default: useOrgStore } = await import('@/store/orgStore')
    useOrgStore.getState().reset()
    set({
      user: null,
      profile: null,
      profileError: null,
      passwordRecovery: false,
      sessionExpired: expired,
      loginType: 'counsellee',
    })
  },

  /**
   * Network first, so changes an admin makes (role, name) appear on the next
   * launch; the last-known copy is only a fallback when offline.
   */
  fetchProfile: async (userId) => {
    const cached = readProfileCache(userId)
    if (!cached) set({ profileLoading: true, profileError: null })

    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (error) throw error
      if (!data) throw new Error('Profile not found')

      const profile = withDisplayName(data)
      writeProfileCache(profile)
      if (!localStorage.getItem('loginType')) {
        const lt = MENTOR_ROLES.includes(profile.role) ? 'counsellor' : 'counsellee'
        localStorage.setItem('loginType', lt)
        set({ loginType: lt })
      }
      set({ profile, profileError: null })
      // Register for push notifications (FCM native / Web Push). Fire-and-forget.
      import('@/lib/push.js').then((m) => m.registerPush(userId)).catch(() => {})
    } catch (error) {
      logger.warn('[auth] fetchProfile failed:', error)
      if (cached) set({ profile: cached, profileError: null })
      else set({ profileError: error.message || 'Failed to load profile' })
    } finally {
      set({ profileLoading: false })
    }
  },

  signInWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
    return data
  },

  signUpWithEmail: async (email, password, spiritualName) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { spiritual_name: spiritualName.trim() } },
    })
    if (error) throw error
    return data
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectUrl(),
    })
    if (error) throw error
  },

  /** Completes a reset: the recovery link has already signed the user in. */
  updatePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    set({ passwordRecovery: false })
  },

  dismissSessionExpired: () => set({ sessionExpired: false }),

  signOut: async () => {
    userInitiatedSignOut = true
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) logger.warn('[auth] signOut failed:', error.message)
    // Local state is cleared even if the server call failed (e.g. offline):
    // the user asked to sign out of THIS device.
    await get()._resetLocalState()
    return { error }
  },

  updateProfile: async (updates) => {
    const { profile } = get()
    if (!profile) return { data: null, error: new Error('Not signed in') }
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)
      .select()
      .single()
    if (!error && data) {
      const next = withDisplayName(data)
      writeProfileCache(next)
      set({ profile: next })
    }
    return { data, error }
  },
}))

export default useAuthStore
