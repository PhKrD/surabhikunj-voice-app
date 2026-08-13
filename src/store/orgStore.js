import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

const useOrgStore = create((set, get) => ({
  org: null,           // { id, name, slug, logo_url, ... }
  settings: null,      // { branding, terminology, features }
  nav: [],             // my_navigation() result
  permissions: [],     // my_permissions() result — flat string array
  loading: true,
  initialized: false,
  needsOnboarding: false, // signed in but belongs to no active organization

  // ----------------------------------------------------------------
  // Bootstrap: called once after authStore has a user + profile
  // ----------------------------------------------------------------
  initialize: async () => {
    if (get().initialized) return
    try {
      await get()._load()
    } catch (e) {
      console.error('[org] init failed:', e)
    } finally {
      set({ loading: false, initialized: true })
    }
  },

  reset: () => set({
    org: null, settings: null, nav: [], permissions: [],
    loading: false, initialized: false, needsOnboarding: false,
  }),

  // Re-run the bootstrap after founding or joining an organization
  refresh: async () => {
    set({ loading: true })
    try {
      // Force a session refresh so DB functions see the updated active_org_id
      await supabase.auth.refreshSession()
      await get()._load()
    } catch (e) {
      console.error('[org] refresh failed:', e)
    } finally {
      set({ loading: false, initialized: true })
    }
  },

  // ----------------------------------------------------------------
  // Switch to a different organization the user belongs to
  // ----------------------------------------------------------------
  switchOrg: async (orgId) => {
    set({ loading: true })
    try {
      const { error } = await supabase.rpc('switch_organization', { p_org_id: orgId })
      if (error) throw error
      await get()._load()
    } finally {
      set({ loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Internal: fetch everything the platform layer needs
  // ----------------------------------------------------------------
  _load: async () => {
    // Ensure active_org_id is set in the profile before any other query.
    // This auto-repairs the common case where an existing admin logs in
    // and profiles.active_org_id is NULL despite having an active membership.
    await supabase.rpc('ensure_active_org')

    const [orgsRes, navRes, permRes] = await Promise.all([
      // Active org info from the membership view
      supabase.rpc('my_organizations'),
      // Dynamic navigation
      supabase.rpc('my_navigation'),
      // Resolved permission set for this user in this org
      supabase.rpc('my_permissions'),
    ])

    if (orgsRes.error) throw orgsRes.error

    const activeOrgRow = (orgsRes.data ?? []).find((o) => o.is_active) ?? orgsRes.data?.[0]

    // No active membership is a legitimate state for a fresh signup, not an
    // error: the user still has to found an org or join one with a code.
    if (!activeOrgRow) {
      set({
        org: null, settings: null, nav: [], permissions: [],
        needsOnboarding: true,
      })
      return
    }

    // Fetch full org details + settings for the active org.
    // Use maybeSingle() so a stale RLS context (current_org_id not yet
    // refreshed) returns null instead of throwing, and we can retry via
    // the needsOnboarding path rather than crashing the whole store.
    const orgRes = await supabase
      .from('organizations')
      .select('id, name, slug, logo_url, status, timezone, locale, join_code, organization_settings(branding, terminology, features)')
      .eq('id', activeOrgRow.org_id)
      .maybeSingle()

    if (orgRes.error) throw orgRes.error
    if (!orgRes.data) {
      // RLS blocked the read (active_org_id not yet visible in this session).
      // Mark onboarding so the caller can retry.
      set({ org: null, settings: null, nav: [], permissions: [], needsOnboarding: true })
      return
    }

    const orgData = orgRes.data
    const settings = orgData.organization_settings ?? { branding: {}, terminology: {}, features: {} }

    // Apply CSS custom properties for theming
    applyBranding(settings.branding ?? {})

    set({
      org: {
        id:       orgData.id,
        name:     orgData.name,
        slug:     orgData.slug,
        logo_url: orgData.logo_url,
        status:    orgData.status,
        timezone:  orgData.timezone,
        locale:    orgData.locale,
        join_code: orgData.join_code,
      },
      settings,
      nav:         navRes.data  ?? [],
      permissions: permRes.data ?? [],
      needsOnboarding: false,
    })
  },

  // ----------------------------------------------------------------
  // Helpers (synchronous — reads from store state)
  // ----------------------------------------------------------------
  hasPermission: (key) => {
    const { permissions } = get()
    return permissions.includes('*') || permissions.includes(key)
  },

  hasAnyPermission: (keys) => {
    const { permissions } = get()
    if (permissions.includes('*')) return true
    return keys.some((k) => permissions.includes(k))
  },

  // Resolve an org-specific term, with platform fallback
  // e.g. t('member') → 'Devotee' for Surabhikunj
  t: (key, fallback) => {
    const terminology = get().settings?.terminology ?? {}
    return terminology[key] ?? fallback ?? key
  },
}))

// ----------------------------------------------------------------
// Branding → CSS custom properties
// ----------------------------------------------------------------
function applyBranding(branding) {
  const root = document.documentElement
  if (branding.primaryColor) {
    root.style.setProperty('--color-primary', branding.primaryColor)
  }
  if (branding.accentColor) {
    root.style.setProperty('--color-accent', branding.accentColor)
  }
}

export default useOrgStore
