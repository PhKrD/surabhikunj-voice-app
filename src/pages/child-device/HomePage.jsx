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

import { useEffect, useState, useCallback } from 'react'
import { ShieldAlert, Plus, Settings, Send, WifiOff, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller, stopCommandPoller } from '../../lib/commandPoller.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'
import { getTodayUsage, hasUsageAccess, openUsageAccessSettings, syncInstalledApps } from '../../lib/usageStatsPlugin.js'
import SetupChecklistCard from '../../components/child-device/SetupChecklistCard.jsx'

const RING_RADIUS = 68
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function HomePage() {
  const navigate = useNavigate()
  const { childName, bonusActive, internetPaused, setLastCommand, screenTime } = useDeviceState()
  const [usageMinutes, setUsageMinutes] = useState(null)
  const [usageAccessGranted, setUsageAccessGranted] = useState(true)

  // Command handler — updates UI when DPC commands arrive. Lock/unlock
  // navigation is driven by the native enforcement snapshot in
  // ChildDeviceShell, not by individual commands.
  useEffect(() => {
    startCommandPoller((cmd) => setLastCommand(cmd))
    return () => stopCommandPoller()
  }, [setLastCommand])

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

  const used = usageMinutes ?? 0
  const limit = screenTime.limitMin
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const over = limit != null && used >= limit
  const remaining = limit != null ? Math.max(0, limit - used) : null

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header + screen-time ring */}
      <div className="bg-gradient-to-b from-indigo-600 to-indigo-700 text-white px-6 pt-14 pb-10 rounded-b-[2rem]">
        <p className="text-indigo-200 text-sm">{getGreeting()}</p>
        <h1 className="text-2xl font-bold mt-0.5">{childName || 'Hi there!'}</h1>

        <div className="flex items-center justify-center mt-6">
          {usageAccessGranted ? (
            <div className="relative w-40 h-40 flex flex-col items-center justify-center">
              <svg width={160} height={160} viewBox="0 0 160 160" className="absolute inset-0 -rotate-90 pointer-events-none">
                <circle cx={80} cy={80} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={10} />
                {limit != null && (
                  <circle
                    cx={80} cy={80} r={RING_RADIUS}
                    fill="none"
                    stroke={over ? '#FCA5A5' : '#A5B4FC'}
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
                    className="transition-[stroke-dashoffset] duration-700"
                  />
                )}
              </svg>
              <p className="text-4xl font-bold tabular-nums">{usageMinutes === null ? '—' : formatMinutes(used)}</p>
              <p className="text-xs text-indigo-200 mt-1">
                {limit == null ? 'used today' : over ? "today's limit reached" : `of ${formatMinutes(limit)}`}
              </p>
            </div>
          ) : (
            <button
              onClick={openUsageAccessSettings}
              className="flex items-center gap-2 text-sm bg-white/10 border border-white/20 rounded-2xl px-4 py-3 my-6"
            >
              <Settings size={16} />
              Turn on screen time tracking
            </button>
          )}
        </div>

        {usageAccessGranted && limit != null && !over && (
          <p className="text-center text-sm text-indigo-100 mt-1">{formatMinutes(remaining)} left today</p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-5 flex flex-col gap-3">
        <SetupChecklistCard />

        {bonusActive && (
          <StatusPill tone="emerald" icon={Sparkles} text="Bonus time is active right now" />
        )}
        {internetPaused && (
          <StatusPill tone="amber" icon={WifiOff} text="Your parents have paused the internet" />
        )}

        <button
          onClick={() => navigate('/child/bonus')}
          className="w-full bg-white rounded-3xl px-5 py-4 flex items-center gap-3 shadow-sm active:bg-slate-100 transition-colors"
        >
          <span className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
            <Plus size={20} className="text-indigo-600" />
          </span>
          <span className="text-left">
            <span className="block font-semibold text-slate-800">Ask for more screen time</span>
            <span className="block text-xs text-slate-500">Your parents get a notification</span>
          </span>
        </button>

        <button
          onClick={() => navigate('/child/request')}
          className="w-full bg-white rounded-3xl px-5 py-4 flex items-center gap-3 shadow-sm active:bg-slate-100 transition-colors"
        >
          <span className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
            <Send size={18} className="text-slate-600" />
          </span>
          <span className="text-left">
            <span className="block font-semibold text-slate-800">Ask for something else</span>
            <span className="block text-xs text-slate-500">Unblock an app, a website, anything</span>
          </span>
        </button>

        <div className="flex-1 min-h-4" />

        <button
          onClick={() => navigate('/child/sos')}
          className="w-full bg-red-500 active:bg-red-600 text-white font-bold text-lg rounded-3xl py-5 flex items-center justify-center gap-3 shadow-lg shadow-red-500/25 transition-colors"
        >
          <ShieldAlert size={26} />
          SOS — I need help
        </button>
        <p className="text-xs text-slate-400 text-center pb-2">
          Only in an emergency. Your parents are alerted straight away.
        </p>
      </div>
    </div>
  )
}

function StatusPill({ tone, icon: Icon, text }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium ${tones[tone]}`}>
      <Icon size={17} className="shrink-0" />
      {text}
    </div>
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
