import useOrgStore from '@/store/orgStore'

/**
 * Returns true if the current user holds the given permission in their active org.
 *
 * Usage:
 *   const canManageMembers = usePermission('members.manage')
 *   const canEdit = usePermission(['events.create', 'events.manage'])  // any of these
 */
export function usePermission(keyOrKeys) {
  const { hasPermission, hasAnyPermission } = useOrgStore()
  if (Array.isArray(keyOrKeys)) return hasAnyPermission(keyOrKeys)
  return hasPermission(keyOrKeys)
}

/**
 * Returns the full permission set for the active org.
 * Useful when you need to check many permissions at once.
 */
export function usePermissions() {
  return useOrgStore((s) => s.permissions)
}

/**
 * Returns the org-specific term for a platform noun.
 * e.g. useTerm('member') → 'Devotee' for Surabhikunj, 'Member' for a generic org.
 */
export function useTerm(key, fallback) {
  return useOrgStore((s) => s.t(key, fallback))
}

export default usePermission
