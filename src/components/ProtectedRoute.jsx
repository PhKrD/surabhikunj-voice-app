import { Navigate, useLocation } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import { LoadingState } from '@/components/ui/States'

// Signed-in only. Used by /onboarding, which must stay reachable precisely
// when there is no organization yet — so it cannot use ProtectedRoute.
export function RequireAuth({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <LoadingState fullScreen />
  if (!user) return <Navigate to="/login" replace />
  return children
}

/**
 * UI guard only: it decides what to SHOW. Every read and write is enforced
 * independently by Postgres row-level security, so changing a URL or
 * client state cannot grant access to data.
 */
export default function ProtectedRoute({ children, permission }) {
  const { user, loading } = useAuthStore()
  const { loading: orgLoading, needsOnboarding, hasPermission, hasAnyPermission } = useOrgStore()
  const location = useLocation()

  if (loading) return <LoadingState fullScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Org context decides both onboarding and approval, so wait for it rather
  // than guessing. Without this a fresh signup flashes the dashboard first.
  if (orgLoading) return <LoadingState fullScreen label="Loading your organization…" />

  // Belongs to no active organization: found one or join one with a code.
  if (needsOnboarding) return <Navigate to="/onboarding" replace />

  if (permission) {
    const granted = Array.isArray(permission) ? hasAnyPermission(permission) : hasPermission(permission)
    if (!granted) return <Navigate to="/" replace />
  }

  return children
}
