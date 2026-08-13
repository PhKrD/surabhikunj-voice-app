import useOrgStore from '@/store/orgStore'

/**
 * Renders children only when the active user holds the required permission(s).
 *
 * Props:
 *   permission   string | string[]   — required permission key(s); any match passes
 *   fallback     ReactNode           — rendered when access is denied (default: null)
 *
 * Usage:
 *   <Can permission="members.manage">
 *     <ManageMembersButton />
 *   </Can>
 *
 *   <Can permission={['events.create', 'events.manage']} fallback={<ReadOnly />}>
 *     <EditEvent />
 *   </Can>
 */
export default function Can({ permission, fallback = null, children }) {
  const { hasPermission, hasAnyPermission } = useOrgStore()

  const granted = Array.isArray(permission)
    ? hasAnyPermission(permission)
    : hasPermission(permission)

  return granted ? children : fallback
}
