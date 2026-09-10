/**
 * HomePage.jsx
 * The child's main screen after enrollment.
 *
 * Deliberately minimal — the child sees:
 *   • Their name + a friendly greeting
 *   • Real screen time today (UsageStatsManager, refreshed on mount + focus)
 *   • A large SOS button
 *   • A "Request more time" button
 *
 * The command poller is started here and runs for the app's lifetime.
 */

import { useEffect, useState, useCallback } from 'react'
import { ShieldAlert, Clock, Plus, Settings, Send } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller, stopCommandPoller } from '../../lib/commandPoller.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'
import { getTodayUsage, hasUsageAccess, openUsageAccessSettings, syncInstalledApps } from '../../lib/usageStatsPlugin.js'
import SetupChecklistCard from '../../components/child-device/SetupChecklistCard.jsx'

export default function HomePage() {
  const navigate = useNavigate()
  const { childName, bonusActive, setLastCommand, screenTime } = useDeviceState()
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

  const greeting = getGreeting()

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col">
      {/* Header */}
      <div className="bg-indigo-600 text-white px-6 pt-12 pb-8">
        <p className="text-indigo-200 text-sm">{greeting}</p>
        <h1 className="text-2xl font-bold mt-1">{childName || 'Hi there!'}</h1>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-8 flex flex-col gap-6">
        {/* Outstanding permissions needed for parental control to actually work */}
        <SetupChecklistCard />

        {/* Screen time card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Clock size={20} className="text-indigo-500" />
            <span className="font-semibold text-gray-700">Screen time today</span>
          </div>

          {usageAccessGranted ? (
            <>
              <p className="text-3xl font-bold text-indigo-600">
                {usageMinutes === null ? '—' : formatMinutes(usageMinutes)}
                {screenTime.limitMin != null && (
                  <span className="text-base font-medium text-gray-400"> / {formatMinutes(screenTime.limitMin)}</span>
                )}
              </p>
              {screenTime.limitMin != null && (
                <div className="mt-3">
                  <div className="h-2 w-full bg-indigo-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(usageMinutes ?? 0) >= screenTime.limitMin ? 'bg-red-500' : 'bg-indigo-500'}`}
                      style={{ width: `${screenTime.limitMin > 0 ? Math.min(100, Math.round(((usageMinutes ?? 0) / screenTime.limitMin) * 100)) : 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    {Math.max(0, screenTime.limitMin - (usageMinutes ?? 0)) > 0
                      ? `${formatMinutes(Math.max(0, screenTime.limitMin - (usageMinutes ?? 0)))} left today`
                      : "Today's limit reached"}
                  </p>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={openUsageAccessSettings}
              className="flex items-center gap-2 text-sm text-indigo-600 font-medium mt-1"
            >
              <Settings size={16} />
              Tap to enable screen time tracking
            </button>
          )}

          {bonusActive && (
            <div className="mt-3 bg-green-50 text-green-700 rounded-xl px-3 py-2 text-sm font-medium">
              Bonus time is active
            </div>
          )}
        </div>

        {/* Request more time */}
        <button
          onClick={() => navigate('/child/bonus')}
          className="w-full bg-white border-2 border-indigo-200 hover:border-indigo-400 text-indigo-700 font-semibold rounded-2xl py-4 flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={20} />
          Request more screen time
        </button>

        {/* General request */}
        <button
          onClick={() => navigate('/child/request')}
          className="w-full bg-white border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-semibold rounded-2xl py-4 flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          <Send size={20} />
          Ask for something else
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* SOS Button */}
        <button
          onClick={() => navigate('/child/sos')}
          className="w-full bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold text-xl rounded-3xl py-6 flex items-center justify-center gap-3 shadow-lg transition-all"
        >
          <ShieldAlert size={28} />
          SOS — I need help
        </button>

        <p className="text-xs text-gray-400 text-center">
          Press SOS only in an emergency. Your parents will be notified immediately.
        </p>
      </div>
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
