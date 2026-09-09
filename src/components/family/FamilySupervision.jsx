/**
 * FamilySupervision.jsx
 *
 * Mounted once at the App root (see src/App.jsx), regardless of which
 * route is currently showing. Only does anything when THIS device is both
 * enrolled as a supervised child device AND signed in as a real org
 * member (src/lib/deviceStore.js isOrgMemberDevice()) — i.e. the "child +
 * org member coexistence" case. The legacy fully-isolated device-only
 * experience (src/components/child-device/ChildDeviceShell.jsx) still
 * manages its own command-poller lifecycle unchanged.
 *
 * Responsibilities:
 *   1. Keep the native background monitor service session in sync and
 *      the JS command poller running for foreground responsiveness — the
 *      SAME mechanisms src/pages/child-device/HomePage.jsx used to own,
 *      just started globally instead of per-page now that there's no
 *      single "child home" route this device is confined to.
 *   2. Render a full-screen lock overlay ON TOP of whatever page is open
 *      (Sadhana, cleanliness, Dashboard, ...) when the parent locks the
 *      device or a blocking schedule is active — the JS-layer backup to
 *      VoiceKidsAccessibilityService's native soft-block, exactly like
 *      src/pages/child-device/LockedPage.jsx, just not tied to a specific
 *      route so it can appear regardless of what's on screen.
 */

import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller, stopCommandPoller } from '../../lib/commandPoller.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'
import { syncInstalledApps } from '../../lib/usageStatsPlugin.js'

function LockOverlay() {
  const navigate = useNavigate()

  // Block the back button while locked, same as LockedPage.jsx.
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); history.pushState(null, '', location.href) }
    window.addEventListener('popstate', handler)
    history.pushState(null, '', location.href)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-900 flex flex-col items-center justify-center px-8 gap-8 text-white">
      <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
        <Clock size={48} className="text-indigo-400" />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-bold">Screen time paused</h1>
        <p className="text-gray-400 mt-3">
          Your parents have scheduled a break. Come back later or ask for more time.
        </p>
      </div>
      {/* Only SOS is accessible during lock */}
      <button
        onClick={() => navigate('/family/sos')}
        className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl px-8 py-4 flex items-center gap-2"
      >
        SOS — I need help
      </button>
      <p className="text-xs text-gray-600 text-center mt-4">
        The SOS button is always available for emergencies.
      </p>
    </div>
  )
}

export default function FamilySupervision() {
  const enrolled = useDeviceState((s) => s.enrolled)
  const isOrgMember = useDeviceState((s) => s.isOrgMember)
  const isLocked = useDeviceState((s) => s.isLocked)
  const setLocked = useDeviceState((s) => s.setLocked)
  const setBonusActive = useDeviceState((s) => s.setBonusActive)
  const setLastCommand = useDeviceState((s) => s.setLastCommand)
  const location = useLocation()

  const active = enrolled && isOrgMember

  useEffect(() => {
    if (!active) return
    syncSessionAndStartTracking().catch(() => {})
    syncInstalledApps().catch(() => {})
    startCommandPoller((cmd) => {
      setLastCommand(cmd)
      if (cmd.command_type === 'lock_device' || cmd.command_type === 'pause_internet') {
        setLocked(true)
      } else if (cmd.command_type === 'unlock_device' || cmd.command_type === 'resume_internet' || cmd.command_type === 'sync_rules') {
        setLocked(false)
      } else if (cmd.command_type === 'grant_bonus_time') {
        setBonusActive(true)
      } else if (cmd.command_type === 'revoke_bonus_time') {
        setBonusActive(false)
      }
    })
    return () => stopCommandPoller()
  }, [active, setLastCommand, setLocked, setBonusActive])

  // SOS must always be reachable even while locked — don't render the
  // overlay on top of the SOS page itself.
  if (!active || !isLocked || location.pathname === '/family/sos') return null
  return <LockOverlay />
}
