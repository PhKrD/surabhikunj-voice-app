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

import { Clock, Moon, Lock, Hourglass, Plus, ShieldAlert } from 'lucide-react'
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
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-8 gap-7 text-white">
      <div className="w-24 h-24 bg-white/5 border border-white/10 rounded-3xl flex items-center justify-center">
        <Icon size={44} className="text-indigo-300" />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-3xl font-bold leading-tight">{copy.title}</h1>
        <p className="text-slate-400 mt-3 leading-relaxed">{copy.body}</p>
        {reason === 'schedule' && lockLabel && (
          <p className="inline-block mt-4 text-xs font-medium text-indigo-200 bg-indigo-500/15 rounded-full px-3 py-1.5">
            {lockLabel}
          </p>
        )}
        {reason === 'daily_limit' && screenTime.limitMin != null && (
          <p className="inline-block mt-4 text-xs font-medium text-indigo-200 bg-indigo-500/15 rounded-full px-3 py-1.5">
            {formatMinutes(screenTime.usedMin ?? screenTime.limitMin)} used of {formatMinutes(screenTime.limitMin)}
          </p>
        )}
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3 mt-2">
        {canAsk && (
          <button
            onClick={() => navigate('/child/bonus')}
            className="w-full bg-indigo-500 active:bg-indigo-600 text-white font-semibold rounded-2xl py-4 flex items-center justify-center gap-2"
          >
            <Plus size={20} />
            Ask for more time
          </button>
        )}

        {/* SOS is always accessible during lock */}
        <button
          onClick={() => navigate('/child/sos')}
          className="w-full bg-red-600/90 active:bg-red-600 text-white font-bold rounded-2xl py-4 flex items-center justify-center gap-2"
        >
          <ShieldAlert size={20} />
          SOS — I need help
        </button>
      </div>

      <p className="text-xs text-slate-600 text-center">
        SOS always works, even while the device is locked.
      </p>
    </div>
  )
}
