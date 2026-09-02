import { Navigate } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import { Loader2 } from 'lucide-react'

function Spinner({ label = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center h-screen bg-[var(--surface-muted)]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-saffron-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-secondary-token">{label}</p>
      </div>
    </div>
  )
}

// Signed-in only. Used by /onboarding, which must stay reachable precisely
// when there is no organization yet — so it cannot use ProtectedRoute.
export function RequireAuth({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function ProtectedRoute({ children, permission }) {
  const { user, loading } = useAuthStore()
  const {
    loading: orgLoading, needsOnboarding, hasPermission, hasAnyPermission,
  } = useOrgStore()

  if (loading) return <Spinner />

  if (!user) return <Navigate to="/login" replace />

  // Org context decides both onboarding and approval, so wait for it rather
  // than guessing. Without this a fresh signup flashes the dashboard first.
  if (orgLoading) return <Spinner label="Loading organization..." />

  // Belongs to no active organization: found one or join one with a code.
  // (my_organizations() only returns memberships with status = 'active', so
  // this also covers "in an org but pending admin approval" — the pending
  // case is surfaced by the /onboarding page itself via my_pending_memberships().)
  if (needsOnboarding) return <Navigate to="/onboarding" replace />

  if (permission) {
    const granted = Array.isArray(permission)
      ? hasAnyPermission(permission)
      : hasPermission(permission)
    if (!granted) return <Navigate to="/" replace />
  }

  return children
}
