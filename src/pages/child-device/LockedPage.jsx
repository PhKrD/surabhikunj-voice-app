/**
 * LockedPage.jsx
 * Full-screen lock shown when the native policy engine reports the device
 * is locked: today's screen-time limit reached, a restricted hour, a
 * blocking schedule, or the parent's "Lock now". Wording is contextual
 * (screenTimePolicy.js LOCK_REASON_COPY), matching what the native
 * BlockOverlay says when a blocked app is kicked to home.
 *
 * This is the WebView-layer face of the lock. The real enforcement —
 * including while this app is backgrounded — comes from
 * VoiceKidsAccessibilityService (Device Admin + Accessibility, no factory
 * reset needed): it kicks any disallowed foreground app back to home. See
 * PLATFORM_LIMITATIONS.md for what that soft-lock does and doesn't
 * guarantee. Navigation away from here when the lock lifts is handled by
 * ChildDeviceShell, which watches the same snapshot.
 */

import { Clock, Moon, Lock, Hourglass, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller } from '../../lib/commandPoller.js'
import { LOCK_REASON_COPY, formatMinutes } from '../../lib/screenTimePolicy.js'

const ICONS = { daily_limit: Hourglass, restricted_time: Moon, schedule: Clock, parent_lock: Lock }

export default function LockedPage() {
  const navigate = useNavigate()
  const { setLastCommand, lockReason, lockLabel, screenTime } = useDeviceState()

  // Keep listening — parent may unlock, resume, or grant bonus time.
  useEffect(() => {
    startCommandPoller((cmd) => setLastCommand(cmd))
  }, [setLastCommand])

  // Block back button
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); history.pushState(null, '', location.href) }
    window.addEventListener('popstate', handler)
    history.pushState(null, '', location.href)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const reason = lockReason ?? 'schedule'
  const copy = LOCK_REASON_COPY[reason] ?? LOCK_REASON_COPY.schedule
  const Icon = ICONS[reason] ?? Clock
  const canAsk = reason !== 'parent_lock'

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-8 gap-8 text-white">
      <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
        <Icon size={48} className="text-indigo-400" />
      </div>

      <div className="text-center">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-gray-400 mt-3">{copy.body}</p>
        {reason === 'schedule' && lockLabel && (
          <p className="text-indigo-300 text-sm mt-2">Schedule: {lockLabel}</p>
        )}
        {reason === 'daily_limit' && screenTime.limitMin != null && (
          <p className="text-indigo-300 text-sm mt-2">
            {formatMinutes(screenTime.usedMin ?? screenTime.limitMin)} used of today&apos;s {formatMinutes(screenTime.limitMin)}
          </p>
        )}
      </div>

      {canAsk && (
        <button
          onClick={() => navigate('/child/bonus')}
          className="w-full max-w-xs bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-2xl py-4 flex items-center justify-center gap-2"
        >
          <Plus size={20} />
          Ask for more time
        </button>
      )}

      {/* SOS is always accessible during lock */}
      <button
        onClick={() => navigate('/child/sos')}
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
