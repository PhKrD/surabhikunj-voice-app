// ChildDeviceShell.jsx
// Mounted by App.jsx ONLY when deviceModeStore.mode === 'child'. At that
// point this device shows nothing but the supervised-child experience —
// no org login, no AppLayout nav — matching the "never shows the org
// login screen again on this device" requirement.
//
// Ported from the former standalone VOICE Kids app's App.jsx (AppShell),
// unchanged in behavior: owns the command-poller lifecycle, reacts to
// lock/unlock commands with navigation, and handles server-side device
// revocation by clearing local state and returning to pairing.
import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { isEnrolled, updateDeviceTokens, clearDeviceCreds } from '@/lib/deviceStore.js'
import { supabase } from '@/lib/supabase.js'
import { syncSession } from '@/lib/locationPlugin.js'
import { startCommandPoller, stopCommandPoller } from '@/lib/commandPoller.js'
import { useEnforcementSnapshot } from '@/lib/useEnforcementSnapshot.js'
import { useDeviceState } from '@/store/childDeviceState.js'
import EnrollmentPage from '@/pages/child-device/EnrollmentPage.jsx'
import HomePage from '@/pages/child-device/HomePage.jsx'
import SosPage from '@/pages/child-device/SosPage.jsx'
import BonusTimePage from '@/pages/child-device/BonusTimePage.jsx'
import RequestPage from '@/pages/child-device/RequestPage.jsx'
import LockedPage from '@/pages/child-device/LockedPage.jsx'
import PermissionWizardPage from '@/pages/child-device/PermissionWizardPage.jsx'

function RequireEnrollment({ children }) {
  const enrolled = useDeviceState((s) => s.enrolled)
  return enrolled ? children : <Navigate to="/child/enroll" replace />
}

export default function ChildDeviceShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const enrolled = useDeviceState((s) => s.enrolled)
  const isLocked = useDeviceState((s) => s.isLocked)
  const setRevoked = useDeviceState((s) => s.setRevoked)

  // Mirror the native engine's lock state (daily limit / restricted time /
  // schedule / parent lock) into the store, then route on it: the lock
  // screen appears the moment the device locks and goes away the moment it
  // unlocks, regardless of which command or timer caused it. SOS, the
  // request pages and enrollment stay reachable while locked.
  useEnforcementSnapshot(enrolled)
  useEffect(() => {
    if (!enrolled) return
    const path = location.pathname
    const reachableWhileLocked = ['/child/locked', '/child/sos', '/child/bonus', '/child/request', '/child/setup']
    if (isLocked && !reachableWhileLocked.includes(path)) navigate('/child/locked', { replace: true })
    else if (!isLocked && path === '/child/locked') navigate('/child/home', { replace: true })
  }, [enrolled, isLocked, location.pathname, navigate])

  useEffect(() => {
    const onRevoked = () => {
      console.warn('[ChildDeviceShell] Device revoked by parent — clearing credentials')
      clearDeviceCreds()
      setRevoked()
      stopCommandPoller()
      navigate('/child/enroll', { replace: true })
    }
    window.addEventListener('vk:device_revoked', onRevoked)
    return () => window.removeEventListener('vk:device_revoked', onRevoked)
  }, [navigate, setRevoked])

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isEnrolled() || !session) return
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        updateDeviceTokens(session.access_token, session.refresh_token)
        syncSession()
      }
    })
    return () => subscription?.subscription?.unsubscribe()
  }, [])

  useEffect(() => {
    if (!enrolled) return
    // Lock/unlock navigation is driven by the native snapshot above (the
    // parent's lock_device becomes a persistent parent_lock there), so the
    // poller only needs to keep running for command acks + bonus/SOS.
    startCommandPoller(() => {})
    return () => stopCommandPoller()
  }, [enrolled])

  return (
    <Routes>
      <Route path="/child/enroll" element={<EnrollmentPage />} />
      <Route path="/child/home" element={<RequireEnrollment><HomePage /></RequireEnrollment>} />
      <Route path="/child/sos" element={<RequireEnrollment><SosPage /></RequireEnrollment>} />
      <Route path="/child/bonus" element={<RequireEnrollment><BonusTimePage /></RequireEnrollment>} />
      <Route path="/child/request" element={<RequireEnrollment><RequestPage /></RequireEnrollment>} />
      <Route path="/child/locked" element={<RequireEnrollment><LockedPage /></RequireEnrollment>} />
      <Route path="/child/setup" element={<RequireEnrollment><PermissionWizardPage /></RequireEnrollment>} />
      <Route path="*" element={<Navigate to={isEnrolled() ? '/child/home' : '/child/enroll'} replace />} />
    </Routes>
  )
}
