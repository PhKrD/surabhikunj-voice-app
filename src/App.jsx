import { Component, useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import useThemeStore from '@/store/themeStore'
import useToastStore from '@/store/toastStore'
import useConfigStore from '@/store/configStore'
import ProtectedRoute, { RequireAuth } from '@/components/ProtectedRoute'
import { reportError } from '@/lib/errorReporter'
import { setNavigator } from '@/lib/navigation'
import { handleOverlayBack, isRootPath } from '@/lib/backButton'
import { exitApp, hideSplash, initNative, onAppResume, syncStatusBar } from '@/lib/native'
import { markBundleHealthy } from '@/lib/liveUpdate'
import Toaster from '@/components/ui/Toaster'
import Button from '@/components/ui/Button'
import { LoadingState } from '@/components/ui/States'
import { ConfirmDialogHost } from '@/components/ui/Dialog'
import AppGate from '@/components/system/AppGate'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import { useDeviceState } from '@/store/childDeviceState'
import ChildDeviceShell from '@/components/child-device/ChildDeviceShell'
import FamilySupervision from '@/components/family/FamilySupervision'

const AppLayout = lazy(() => import('@/components/layout/AppLayout'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
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
    reportError(error, { kind: 'render', componentStack: info?.componentStack?.slice(0, 1500) })
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
    } catch {
      // Best effort: a reload still happens below.
    }
    try {
      if (window.navigator?.serviceWorker?.controller) {
        const reg = await navigator.serviceWorker.ready
        if (reg.unregister) await reg.unregister()
      }
    } catch {
      // Best effort.
    }
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 app-bg">
          <div className="w-full max-w-md glass elev-2 rounded-3xl p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-danger-soft)] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-[var(--color-danger)]" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary-token">Something went wrong</h2>
              <p className="text-sm text-secondary-token mt-1">
                This screen hit an unexpected problem. It has been reported automatically.
                Reloading usually fixes it.
              </p>
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
  return <LoadingState fullScreen label="Loading…" />
}

/**
 * Connects the router to code outside React (notification taps, back
 * button), and owns app-wide lifecycle: native setup, remote config,
 * background refresh on resume, and marking an OTA bundle healthy.
 */
function NativeBridge() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  const navigateRef = useRef(navigate)
  const lastBackRef = useRef(0)
  const isDark = useThemeStore((s) => s.isDark)
  const sessionExpired = useAuthStore((s) => s.sessionExpired)
  const passwordRecovery = useAuthStore((s) => s.passwordRecovery)

  useEffect(() => {
    locationRef.current = location
  }, [location])

  useEffect(() => {
    navigateRef.current = navigate
    setNavigator(navigate)
  }, [navigate])

  useEffect(() => {
    const isolatedChild = () =>
      useDeviceModeStore.getState().mode === 'child' && !useDeviceState.getState().isOrgMember
    initNative({
      onBack: () => {
        if (handleOverlayBack()) return
        const { pathname } = locationRef.current
        if (!isRootPath(pathname) && window.history.length > 1) {
          navigateRef.current(-1)
          return
        }
        // A supervised child's locked screen must not be escapable with back.
        if (isolatedChild()) return
        if (Date.now() - lastBackRef.current < 2000) {
          exitApp()
        } else {
          lastBackRef.current = Date.now()
          useToastStore.getState().info('Press back again to exit', '', { duration: 2000 })
        }
      },
    })
    useConfigStore.getState().start()
    const offResume = onAppResume(() => {
      import('@/store/orgStore').then((m) => m.default.getState().refreshQuietly())
    })
    // The app has rendered: the running OTA bundle works, and the native
    // splash can give way to the real UI.
    markBundleHealthy()
    hideSplash()
    return offResume
  }, [])

  useEffect(() => {
    syncStatusBar(isDark)
  }, [isDark])

  useEffect(() => {
    if (!sessionExpired) return
    useToastStore.getState().info('Your session has ended', 'Please sign in again to continue.', { duration: 5000 })
    useAuthStore.getState().dismissSessionExpired()
  }, [sessionExpired])

  // Opening a password-reset link always lands on the new-password form.
  useEffect(() => {
    if (passwordRecovery && location.pathname !== '/reset-password') {
      navigate('/reset-password', { replace: true })
    }
  }, [passwordRecovery, location.pathname, navigate])

  return null
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
        <Route path="/reset-password" element={<ResetPasswordPage />} />

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
          {/* The dashboard merged into /parental-control — keep the old link working. */}
          <Route path="parental-control/dashboard" element={<Navigate to="/parental-control" replace />} />
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
          <NativeBridge />
          <AppBootstrap />
          <AppGate>
            <AppRoutes />
            <FamilySupervision />
          </AppGate>
          <ConfirmDialogHost />
        </ErrorBoundary>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  )
}
