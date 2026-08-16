import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Clock, Smartphone } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import useToastStore from '@/store/toastStore'
import { getTodayUsage } from '@/lib/parentalControlApi'

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

const BAR_COLORS = [
  'bg-indigo-500', 'bg-saffron-500', 'bg-tulasi-500',
  'bg-lotus-500', 'bg-blue-500', 'bg-emerald-500',
]

export default function UsageTab({ childId }) {
  const toast = useToastStore()
  const [usage, setUsage] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsage(await getTodayUsage(childId))
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

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  const totalMs = usage.reduce((sum, u) => sum + (u.total_foreground_ms || 0), 0)
  const maxMs = usage.length ? usage[0].total_foreground_ms || 1 : 1

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
