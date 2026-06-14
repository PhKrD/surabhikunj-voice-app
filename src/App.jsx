import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import ProtectedRoute from '@/components/ProtectedRoute'

const AppLayout = lazy(() => import('@/components/layout/AppLayout'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ResidentsPage = lazy(() => import('@/pages/residents/ResidentsPage'))
const ResidentProfilePage = lazy(() => import('@/pages/residents/ResidentProfilePage'))
const SadhanaPage = lazy(() => import('@/pages/sadhana/SadhanaPage'))
const CounsellorPage = lazy(() => import('@/pages/counsellor/CounsellorPage'))
const DepartmentsPage = lazy(() => import('@/pages/departments/DepartmentsPage'))
const ServicesPage = lazy(() => import('@/pages/services/ServicesPage'))
const CleanlinessPage = lazy(() => import('@/pages/cleanliness/CleanlinessPage'))
const KitchenPage = lazy(() => import('@/pages/kitchen/KitchenPage'))
const EventsPage = lazy(() => import('@/pages/events/EventsPage'))
const HierarchyPage = lazy(() => import('@/pages/hierarchy/HierarchyPage'))
const AnnouncementsPage = lazy(() => import('@/pages/announcements/AnnouncementsPage'))
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-saffron-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading page...</p>
      </div>
    </div>
  )
}

function AppBootstrap() {
  const { initialize, initialized } = useAuthStore()

  useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialize, initialized])

  return null
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="residents" element={<ResidentsPage />} />
          <Route path="residents/:id" element={<ResidentProfilePage />} />
          <Route path="sadhana" element={<SadhanaPage />} />
          <Route path="counsellor" element={<CounsellorPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="cleanliness" element={<CleanlinessPage />} />
          <Route path="kitchen" element={<KitchenPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="hierarchy" element={<HierarchyPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppBootstrap />
      <AppRoutes />
    </BrowserRouter>
  )
}
