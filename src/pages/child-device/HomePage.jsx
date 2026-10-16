/**
 * HomePage.jsx
 * The child's main screen after enrollment.
 *
 * Deliberately calm and small: a screen-time ring, whatever is currently
 * in force (bonus time, paused internet), two ways to ask a parent for
 * something, and SOS. Anything the child can't change isn't shown as a
 * control.
 *
 * The command poller is started here and runs for the app's lifetime.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { ShieldAlert, Plus, Settings, Send, WifiOff, Sparkles, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller } from '../../lib/commandPoller.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'
import { getTodayUsage, hasUsageAccess, openUsageAccessSettings, syncInstalledApps } from '../../lib/usageStatsPlugin.js'
import SetupChecklistCard from '../../components/child-device/SetupChecklistCard.jsx'
import { ChildPage, ChildHeader, ChildCard, ChildNote } from '../../components/child-device/ChildScreen.jsx'

const RING_SIZE = 176
const RING_STROKE = 12
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function HomePage() {
  const navigate = useNavigate()
  // Seven taps on the name opens the hidden diagnostics screen (testers).
  const taps = useRef({ n: 0, at: 0 })
  const onNameTap = () => {
    const now = Date.now()
    taps.current = now - taps.current.at < 1500 ? { n: taps.current.n + 1, at: now } : { n: 1, at: now }
    if (taps.current.n >= 7) { taps.current = { n: 0, at: 0 }; navigate('/child/diagnostics') }
  }
  const { childName, bonusActive, internetPaused, setLastCommand, screenTime } = useDeviceState()
  const [usageMinutes, setUsageMinutes] = useState(null)
  const [usageAccessGranted, setUsageAccessGranted] = useState(true)

  // Command handler — updates UI when DPC commands arrive. Lock/unlock
  // navigation is driven by the native enforcement snapshot in
  // ChildDeviceShell, not by individual commands.
  useEffect(() => startCommandPoller((cmd) => setLastCommand(cmd)), [setLastCommand])

  // Ensure the background monitoring service is (re)running — cheap no-op
  // if it's already alive, and handles the "service was killed" case.
  useEffect(() => {
    syncSessionAndStartTracking().catch(() => {})
    // Force sync installed apps on app start so parent can see them immediately
    syncInstalledApps().catch(() => {})
  }, [])

  const refreshUsage = useCallback(async () => {
    const { granted } = await hasUsageAccess()
    setUsageAccessGranted(granted)
    if (!granted) return
    const { totalForegroundMinutes } = await getTodayUsage()
    setUsageMinutes(totalForegroundMinutes)
  }, [])

  useEffect(() => {
    // Defer out of the effect body (setState-in-effect lint rule).
    const timer = setTimeout(() => refreshUsage(), 0)
    document.addEventListener('visibilitychange', refreshUsage)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshUsage)
    }
  }, [refreshUsage])

  const used = screenTime.usedMin ?? usageMinutes ?? 0
  const usageKnown = screenTime.usedMin != null || usageMinutes != null
  const limit = screenTime.limitMin
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const over = limit != null && used >= limit
  const remaining = limit != null ? Math.max(0, limit - used) : null
  const low = remaining != null && !over && remaining <= 15

  return (
    <ChildPage>
      <ChildHeader className="pb-10">
        <p className="text-sm text-white/70">{getGreeting()}</p>
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight select-none" onClick={onNameTap}>
          {childName || 'Hi there!'}
        </h1>

        <div className="flex flex-col items-center mt-6">
          {usageAccessGranted ? (
            <>
              <div className="relative flex flex-col items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
                <svg
                  width={RING_SIZE}
                  height={RING_SIZE}
                  viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                  className="absolute inset-0 -rotate-90 pointer-events-none"
                  aria-hidden="true"
                >
                  <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={RING_STROKE} />
                  {limit != null && (
                    <circle
                      cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
                      fill="none"
                      stroke={over ? '#fca5a5' : low ? '#fdba74' : '#ffffff'}
                      strokeWidth={RING_STROKE}
                      strokeLinecap="round"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
                      className="transition-[stroke-dashoffset] duration-700"
                    />
                  )}
                </svg>
                <p className="text-[2.5rem] leading-none font-bold tabular-nums">{usageKnown ? formatMinutes(used) : '—'}</p>
                <p className="text-xs text-white/70 mt-2">
                  {limit == null ? 'used today' : over ? 'limit reached' : `of ${formatMinutes(limit)} today`}
                </p>
              </div>
              {limit != null && !over && (
                <p className={`mt-3 text-sm font-semibold px-3 py-1 rounded-full ${low ? 'bg-white text-[var(--color-warning)]' : 'bg-white/15 text-white'}`}>
                  {formatMinutes(remaining)} left
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={openUsageAccessSettings}
              className="press flex items-center gap-2 text-sm font-semibold bg-white/15 border border-white/25 rounded-[var(--radius-md)] px-4 h-12 my-6"
            >
              <Settings size={18} />
              Turn on screen time tracking
            </button>
          )}
        </div>
      </ChildHeader>

      <main className="flex-1 px-5 py-5 flex flex-col gap-3">
        <SetupChecklistCard />

        {bonusActive && (
          <ChildNote tone="success" icon={Sparkles}>Extra time is on right now — enjoy!</ChildNote>
        )}
        {internetPaused && (
          <ChildNote tone="warning" icon={WifiOff}>Your parents have paused the internet. Apps that work offline still open.</ChildNote>
        )}

        <ActionRow
          icon={Plus}
          iconClass="bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          title="Ask for more time"
          subtitle="Your parents get a notification"
          onClick={() => navigate('/child/bonus')}
        />
        <ActionRow
          icon={Send}
          iconClass="bg-[var(--color-info-soft)] text-[var(--color-info)]"
          title="Ask for something else"
          subtitle="An app, a website, anything"
          onClick={() => navigate('/child/request')}
        />

        <div className="flex-1 min-h-6" />

        <button
          type="button"
          onClick={() => navigate('/child/sos')}
          className="press w-full h-16 rounded-[var(--radius-lg)] bg-[var(--color-danger)] text-white font-bold text-lg flex items-center justify-center gap-3 shadow-[0_12px_28px_-12px_rgba(220,38,38,0.6)]"
        >
          <ShieldAlert size={26} />
          SOS — I need help
        </button>
        <p className="text-xs text-muted-token text-center pb-2">
          Only in an emergency. Your parents are alerted straight away.
        </p>
      </main>
    </ChildPage>
  )
}

function ActionRow({ icon: Icon, iconClass, title, subtitle, onClick }) {
  return (
    <ChildCard as="button" type="button" onClick={onClick} className="press w-full px-4 py-4 flex items-center gap-3.5 text-left">
      <span className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center shrink-0 ${iconClass}`}>
        <Icon size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-primary-token">{title}</span>
        <span className="block text-xs text-muted-token mt-0.5">{subtitle}</span>
      </span>
      <ChevronRight size={18} className="text-muted-token shrink-0" />
    </ChildCard>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
