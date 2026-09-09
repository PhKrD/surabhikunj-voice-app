/**
 * FamilyHomePage.jsx
 * The "Family" section home screen for a device that is BOTH a normal
 * VOICE org member's device AND paired as a supervised child device (see
 * src/lib/deviceStore.js isOrgMemberDevice() / App.jsx). Unlike the legacy
 * fully-isolated src/pages/child-device/HomePage.jsx, this is reached via
 * a normal route (/family) alongside Sadhana, cleanliness, etc. — the
 * member can always navigate back to the rest of the app from here.
 *
 * The command poller itself is started once, globally, by
 * src/components/family/FamilySupervision.jsx — not on this page — so it
 * keeps running no matter which part of the app is currently open.
 */

import { useEffect, useState, useCallback } from 'react'
import { ShieldAlert, Clock, Plus, Settings, Send, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeviceState } from '../../store/childDeviceState.js'
import { getTodayUsage, hasUsageAccess, openUsageAccessSettings, syncInstalledApps } from '../../lib/usageStatsPlugin.js'
import SetupChecklistCard from '../../components/child-device/SetupChecklistCard.jsx'

export default function FamilyHomePage() {
  const navigate = useNavigate()
  const { childName, bonusActive } = useDeviceState()
  const [usageMinutes, setUsageMinutes] = useState(null)
  const [usageAccessGranted, setUsageAccessGranted] = useState(true)

  useEffect(() => {
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
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-indigo-200 mb-4"
        >
          <ArrowLeft size={16} /> Back to VOICE
        </button>
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
            <p className="text-3xl font-bold text-indigo-600">
              {usageMinutes === null ? '—' : formatMinutes(usageMinutes)}
            </p>
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
          onClick={() => navigate('/family/bonus')}
          className="w-full bg-white border-2 border-indigo-200 hover:border-indigo-400 text-indigo-700 font-semibold rounded-2xl py-4 flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={20} />
          Request more screen time
        </button>

        {/* General request */}
        <button
          onClick={() => navigate('/family/request')}
          className="w-full bg-white border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-semibold rounded-2xl py-4 flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          <Send size={20} />
          Ask for something else
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* SOS Button */}
        <button
          onClick={() => navigate('/family/sos')}
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
