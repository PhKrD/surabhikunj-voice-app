import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Clock, Smartphone, Save, ShieldAlert } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import useToastStore from '@/store/toastStore'
import { getTodayUsage, getScreenTimeRule, upsertScreenTimeRule } from '@/lib/parentalControlApi'

/** Format milliseconds → "2h 14m" / "14m" / "45s". */
function formatDuration(ms) {
  const totalSec = Math.round((ms || 0) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function clamp(val, min, max) {
  const n = parseInt(val, 10)
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}

const BAR_COLORS = [
  'bg-indigo-500', 'bg-saffron-500', 'bg-tulasi-500',
  'bg-lotus-500', 'bg-blue-500', 'bg-emerald-500',
]

export default function UsageTab({ childId }) {
  const toast = useToastStore()
  const [usage, setUsage] = useState([])
  const [rule, setRule] = useState(null)
  const [limit, setLimit] = useState(120)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [usageData, ruleData] = await Promise.all([getTodayUsage(childId), getScreenTimeRule(childId)])
      setUsage(usageData)
      setRule(ruleData)
      setLimit(ruleData?.daily_limit_min ?? 120)
    } catch (error) {
      toast.error('Could not load usage', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  const saveLimit = async () => {
    setSaving(true)
    try {
      const next = clamp(limit, 0, 1440)
      await upsertScreenTimeRule({ childId, dailyLimitMin: next, isEnabled: true })
      toast.success('Daily limit saved')
      await load()
    } catch (error) {
      toast.error('Could not save limit', error.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  const totalMs = usage.reduce((sum, u) => sum + (u.total_foreground_ms || 0), 0)
  const maxMs = usage.length ? usage[0].total_foreground_ms || 1 : 1
  const limitMs = (rule?.daily_limit_min ?? 0) * 60 * 1000
  const progress = limitMs > 0 ? Math.min(100, Math.round((totalMs / limitMs) * 100)) : 0
  const overLimit = limitMs > 0 && totalMs > limitMs

  return (
    <div className="space-y-4">
      {/* Total screen time header */}
      <Card>
        <CardBody className="py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl grad-saffron flex items-center justify-center">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Screen time today</p>
              <p className="text-2xl font-extrabold text-slate-800">{formatDuration(totalMs)}</p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-xl text-slate-400 hover:text-saffron-500 hover:bg-saffron-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </CardBody>
        {limitMs > 0 && (
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={overLimit ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                {overLimit ? 'Limit exceeded' : `${progress}% of daily limit`}
              </span>
              <span className="text-slate-400">{formatDuration(limitMs)}</span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${overLimit ? 'bg-red-500' : 'bg-saffron-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Daily limit editor */}
      <Card>
        <CardBody className="py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ShieldAlert className="w-4 h-4 text-saffron-500" />
            Daily screen-time limit
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={1440}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300"
            />
            <span className="text-sm text-slate-500">minutes</span>
            <button
              onClick={saveLimit}
              disabled={saving}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-saffron-500 text-white text-sm font-medium hover:bg-saffron-600 disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Per-app breakdown */}
      {usage.length === 0 ? (
        <div className="text-center py-10 px-6">
          <Smartphone className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No usage data yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            Usage appears once the child's device reports it. Make sure
            <span className="font-medium"> Usage access </span>
            is enabled on the device (VOICE Kids app → tap "enable screen time tracking").
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {usage.map((app, i) => {
            const pct = Math.max(4, Math.round(((app.total_foreground_ms || 0) / maxMs) * 100))
            return (
              <Card key={app.id}>
                <CardBody className="py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{app.app_name || app.package_name}</p>
                      <p className="text-xs text-slate-400 truncate font-mono">{app.package_name}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
                      {formatDuration(app.total_foreground_ms)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
