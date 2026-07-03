import { Navigate } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import { Loader2 } from 'lucide-react'
import { ADMIN_ROLES } from '@/lib/utils'
import PendingApproval from '@/pages/auth/PendingApproval'

// A user has app access once an admin approves them. Admins/leaders always pass.
function hasAppAccess(profile) {
  if (!profile) return false
  return profile.is_approved === true || ADMIN_ROLES.includes(profile.role)
}

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-saffron-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Gate: once the profile is known, block unapproved (pending) devotees.
  if (profile && !hasAppAccess(profile)) {
    return <PendingApproval />
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  return children
}
