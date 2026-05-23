import { Navigate } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import { Loader2 } from 'lucide-react'

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

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  return children
}
