import { Component, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import useAuthStore from '@/store/authStore'
import useThemeStore from '@/store/themeStore'
import ProtectedRoute, { RequireAuth } from '@/components/ProtectedRoute'
// Imported for its module-level side effect only (starts the singleton
// HealthMonitor's 30s polling loop on app boot) — no named binding needed.
import '@/lib/healthCheck'
import Toaster from '@/components/ui/Toaster'
import Button from '@/components/ui/Button'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import { useDeviceState } from '@/store/childDeviceState'
import ChildDeviceShell from '@/components/child-device/ChildDeviceShell'
import FamilySupervision from '@/components/family/FamilySupervision'

const AppLayout = lazy(() => import('@/components/layout/AppLayout'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const OnboardingPage = lazy(() => import('@/pages/auth/OnboardingPage'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ResidentsPage = lazy(() => import('@/pages/residents/ResidentsPage'))
const ResidentProfilePage = lazy(() => import('@/pages/residents/ResidentProfilePage'))
const DepartmentsPage = lazy(() => import('@/pages/departments/DepartmentsPage'))
const EventsPage = lazy(() => import('@/pages/events/EventsPage'))
const HierarchyPage = lazy(() => import('@/pages/hierarchy/HierarchyPage'))
const AnnouncementsPage = lazy(() => import('@/pages/announcements/AnnouncementsPage'))
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const MembersPage = lazy(() => import('@/pages/members/MembersPage'))
const TrackersPage  = lazy(() => import('@/pages/trackers/TrackersPage'))
const ServicesPage  = lazy(() => import('@/pages/services/ServicesPage'))
const CleanlinessPage = lazy(() => import('@/pages/cleanliness/CleanlinessPage'))
const ResourcesPage = lazy(() => import('@/pages/resources/ResourcesPage'))
const MentorshipPage = lazy(() => import('@/pages/mentorship/MentorshipPage'))
const ReportsPage   = lazy(() => import('@/pages/reports/ReportsPage'))
const BroadcastPage = lazy(() => import('@/pages/admin/BroadcastPage'))
const ParentalControlPage = lazy(() => import('@/pages/parental-control/ParentalControlPage'))
const ParentalControlDashboardPage = lazy(() => import('@/pages/parental-control/ParentalControlDashboardPage'))
const ChildDetailPage = lazy(() => import('@/pages/parental-control/ChildDetailPage'))
const FamilyHomePage = lazy(() => import('@/pages/family/FamilyHomePage'))
const FamilySosPage = lazy(() => import('@/pages/family/FamilySosPage'))
const FamilyBonusPage = lazy(() => import('@/pages/family/FamilyBonusPage'))
const FamilyRequestPage = lazy(() => import('@/pages/family/FamilyRequestPage'))

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, clearing: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Surface the real error in console for anyone with dev tools open
    console.error('[ErrorBoundary]', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleClearAndReload = async () => {
    this.setState({ clearing: true })
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch (e) {
      console.error('Cache clear failed', e)
    }
    try {
      if (window.navigator?.serviceWorker?.controller) {
        const reg = await navigator.serviceWorker.ready
        if (reg.unregister) await reg.unregister()
      }
    } catch (e) {
      console.error('SW unregister failed', e)
    }
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 app-bg">
          <div className="w-full max-w-md glass elev-2 rounded-3xl p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center mx-auto">
              <span className="text-2xl">💥</span>
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-primary-token">Something went wrong</h2>
              <p className="text-sm text-secondary-token mt-1">
                The app crashed. This can happen on iOS PWAs when cached files get out of sync.
              </p>
            </div>
            <div className="text-left rounded-2xl surface-muted p-3 text-xs font-mono text-secondary-token overflow-auto max-h-40">
              {this.state.error?.message || String(this.state.error)}
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={this.handleClearAndReload} loading={this.state.clearing} className="w-full">
                Clear cache & reload
              </Button>
              <Button onClick={this.handleReload} variant="secondary" className="w-full">
                Just reload
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center app-bg">
      <div className="text-center">
        <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
        <p className="text-sm text-secondary-token">Loading page...</p>
      </div>
    </div>
  )
}

function AppBootstrap() {
  const { initialize, initialized } = useAuthStore()
  const deviceMode = useDeviceModeStore((s) => s.mode)
  const isOrgMember = useDeviceState((s) => s.isOrgMember)

  useEffect(() => {
    useThemeStore.getState().init()
  }, [])

  useEffect(() => {
    // A child-mode device's Supabase session belongs to its own throwaway
    // device auth user, not an org member — org bootstrap (profile lookup,
    // org membership resolution) has nothing valid to resolve there and
    // would just be a wasted round trip against tables it has no RLS grant
    // to read anyway. EXCEPT when this child is linked to a real org
    // member (isOrgMember — see 68_child_org_link_and_tamper.sql): then
    // the session IS a real member's own account and org bootstrap must
    // run normally, same as any other device.
    if (deviceMode === 'child' && !isOrgMember) return
    if (!initialized) {
      initialize()
    }
  }, [initialize, initialized, deviceMode, isOrgMember])

  return null
}

function AppRoutes() {
  // A device that has been set up as a supervised child device (see
  // src/store/deviceModeStore.js + DeviceModeSetupPage) with NO linked org
  // member account NEVER shows the org login or any org route — it boots
  // straight into the fully-isolated legacy child experience. This check
  // happens before ProtectedRoute would otherwise redirect an
  // unauthenticated device to /login. A child device that IS linked to a
  // real org member (isOrgMember) instead gets the full org app below,
  // plus a "Family" section + a global lock overlay — see
  // src/components/family/FamilySupervision.jsx.
  const deviceMode = useDeviceModeStore((s) => s.mode)
  const enrolled = useDeviceState((s) => s.enrolled)
  const isOrgMember = useDeviceState((s) => s.isOrgMember)
  if (deviceMode === 'child' && (!enrolled || !isOrgMember)) {
    return (
      <Suspense fallback={<PageFallback />}>
        <ChildDeviceShell />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />

        {/* Family section: reachable alongside the rest of the org app on
            a device that is ALSO paired as a supervised child device.
            Full-bleed, no AppLayout chrome — same style as the legacy
            child-device pages, just not walled off from everything else. */}
        <Route path="/family" element={<RequireAuth><FamilyHomePage /></RequireAuth>} />
        <Route path="/family/sos" element={<RequireAuth><FamilySosPage /></RequireAuth>} />
        <Route path="/family/bonus" element={<RequireAuth><FamilyBonusPage /></RequireAuth>} />
        <Route path="/family/request" element={<RequireAuth><FamilyRequestPage /></RequireAuth>} />

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
          {/* Generic primitive routes */}
          <Route path="trackers/*"  element={<TrackersPage />} />
          <Route path="services/*"  element={<ServicesPage />} />
          <Route path="cleanliness/*" element={<CleanlinessPage />} />
          <Route path="resources/*" element={<ResourcesPage />} />
          <Route path="mentorship/*" element={<MentorshipPage />} />
          <Route path="parental-control" element={<ParentalControlPage />} />
          <Route path="parental-control/dashboard" element={<ParentalControlDashboardPage />} />
          <Route path="parental-control/:childId" element={<ChildDetailPage />} />
          <Route path="reports"     element={<ReportsPage />} />
          <Route
            path="broadcast"
            element={
              <ProtectedRoute permission="announcements.manage">
                <BroadcastPage />
              </ProtectedRoute>
            }
          />

          {/* Legacy domain aliases — redirect to generic equivalents */}
          <Route path="sadhana"     element={<Navigate to="/trackers" replace />} />
          <Route path="counsellor"  element={<Navigate to="/mentorship" replace />} />
          <Route path="tasks/*"     element={<Navigate to="/services" replace />} />
          <Route path="kitchen"     element={<Navigate to="/resources" replace />} />

          {/* Existing pages still using old structure */}
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="events"      element={<EventsPage />} />
          <Route path="hierarchy"   element={<HierarchyPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings"    element={<SettingsPage />} />
          <Route
            path="members"
            element={
              <ProtectedRoute permission="members.manage">
                <MembersPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <BrowserRouter>
        <ErrorBoundary>
          <AppBootstrap />
          <AppRoutes />
          <FamilySupervision />
        </ErrorBoundary>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  )
}
