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
 *   2. Mirror the native policy engine's lock state (daily limit reached,
 *      restricted hour, schedule, parent "Lock now") via
 *      useEnforcementSnapshot and render a full-screen lock overlay ON TOP
 *      of whatever page is open (Sadhana, cleanliness, Dashboard, ...) —
 *      the JS-layer backup to VoiceKidsAccessibilityService's native
 *      soft-block, exactly like src/pages/child-device/LockedPage.jsx,
 *      just not tied to a specific route.
 */

import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Clock, Moon, Lock, Hourglass, Plus } from 'lucide-react'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller, stopCommandPoller } from '../../lib/commandPoller.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'
import { syncInstalledApps } from '../../lib/usageStatsPlugin.js'
import { useEnforcementSnapshot } from '../../lib/useEnforcementSnapshot.js'
import { LOCK_REASON_COPY, formatMinutes } from '../../lib/screenTimePolicy.js'

const ICONS = { daily_limit: Hourglass, restricted_time: Moon, schedule: Clock, parent_lock: Lock }

function LockOverlay({ reason, label, screenTime }) {
  const navigate = useNavigate()

  // Block the back button while locked, same as LockedPage.jsx.
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); history.pushState(null, '', location.href) }
    window.addEventListener('popstate', handler)
    history.pushState(null, '', location.href)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const copy = LOCK_REASON_COPY[reason] ?? LOCK_REASON_COPY.schedule
  const Icon = ICONS[reason] ?? Clock

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-900 flex flex-col items-center justify-center px-8 gap-8 text-white">
      <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
        <Icon size={48} className="text-indigo-400" />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-gray-400 mt-3">{copy.body}</p>
        {reason === 'schedule' && label && <p className="text-indigo-300 text-sm mt-2">Schedule: {label}</p>}
        {reason === 'daily_limit' && screenTime?.limitMin != null && (
          <p className="text-indigo-300 text-sm mt-2">
            {formatMinutes(screenTime.usedMin ?? screenTime.limitMin)} used of today&apos;s {formatMinutes(screenTime.limitMin)}
          </p>
        )}
      </div>
      {reason !== 'parent_lock' && (
        <button
          onClick={() => navigate('/family/bonus')}
          className="w-full max-w-xs bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-2xl py-4 flex items-center justify-center gap-2"
        >
          <Plus size={20} /> Ask for more time
        </button>
      )}
      {/* Only SOS (and the request page) is accessible during lock */}
      <button
        onClick={() => navigate('/family/sos')}
        className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl px-8 py-4 flex items-center gap-2"
      >
        SOS — I need help
      </button>
      <p className="text-xs text-gray-600 text-center">
        The SOS button is always available for emergencies.
      </p>
    </div>
  )
}

export default function FamilySupervision() {
  const enrolled = useDeviceState((s) => s.enrolled)
  const isOrgMember = useDeviceState((s) => s.isOrgMember)
  const isLocked = useDeviceState((s) => s.isLocked)
  const lockReason = useDeviceState((s) => s.lockReason)
  const lockLabel = useDeviceState((s) => s.lockLabel)
  const screenTime = useDeviceState((s) => s.screenTime)
  const setLastCommand = useDeviceState((s) => s.setLastCommand)
  const location = useLocation()

  const active = enrolled && isOrgMember

  useEnforcementSnapshot(active)

  useEffect(() => {
    if (!active) return
    syncSessionAndStartTracking().catch(() => {})
    syncInstalledApps().catch(() => {})
    // Lock state comes from the native snapshot above (the parent's
    // lock_device becomes a persistent parent_lock there); the poller only
    // needs to keep running for command acks + bonus/SOS.
    startCommandPoller((cmd) => setLastCommand(cmd))
    return () => stopCommandPoller()
  }, [active, setLastCommand])

  // SOS + request pages must stay reachable even while locked — don't
  // render the overlay on top of them.
  const reachable = ['/family/sos', '/family/bonus', '/family/request']
  if (!active || !isLocked || reachable.includes(location.pathname)) return null
  return <LockOverlay reason={lockReason} label={lockLabel} screenTime={screenTime} />
}
