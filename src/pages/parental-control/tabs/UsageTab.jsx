import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Clock, Smartphone, Save, Hourglass, Lock, Bell, Ban, Info } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from 'recharts'
import Card, { CardBody } from '@/components/ui/Card'
import useToastStore from '@/store/toastStore'
import { getTodayUsage, getScreenTimeRule, upsertScreenTimeRule, getUsageHistory } from '@/lib/parentalControlApi'
import { limitForDay, formatMinutes } from '@/lib/screenTimePolicy'
import { cn } from '@/lib/utils'

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PRESETS = [30, 60, 90, 120, 180, 240]

const LIMIT_ACTIONS = [
  { value: 'lock_navigation', label: 'Lock navigation', icon: Ban, desc: 'Block every app and pause internet. Calls and VOICE stay available.' },
  { value: 'lock_device', label: 'Lock device', icon: Lock, desc: 'Same as lock navigation, plus the screen is locked immediately.' },
  { value: 'alert_only', label: 'Alert only', icon: Bell, desc: 'Nothing is blocked — you just get an alert when the limit is reached.' },
]

const BAR_COLORS = [
  'bg-indigo-500', 'bg-saffron-500', 'bg-tulasi-500',
  'bg-lotus-500', 'bg-blue-500', 'bg-emerald-500',
]

/** Minutes input that also accepts "h:mm" and shows a friendly label. */
function MinutesField({ value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={1440}
        step={5}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
      />
      <span className="text-xs text-muted-token w-14">{formatMinutes(value)}</span>
    </div>
  )
}

export default function UsageTab({ childId }) {
  const toast = useToastStore()
  const [usage, setUsage] = useState([])
  const [history, setHistory] = useState([])
  const [historyDays, setHistoryDays] = useState(7)
  const [rule, setRule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Editor state
  const [enabled, setEnabled] = useState(true)
  const [sameEveryDay, setSameEveryDay] = useState(true)
  const [baseLimit, setBaseLimit] = useState(120)
  const [byDow, setByDow] = useState({})
  const [limitAction, setLimitAction] = useState('lock_navigation')
  const [alertOnLimit, setAlertOnLimit] = useState(true)

  const load = useCallback(async () => {
    try {
      const [usageData, ruleData, hist] = await Promise.all([
        getTodayUsage(childId),
        getScreenTimeRule(childId),
        getUsageHistory(childId, { days: historyDays }).catch(() => []),
      ])
      setUsage(usageData)
      setRule(ruleData)
      setHistory(hist)
      if (ruleData) {
        setEnabled(ruleData.is_enabled !== false)
        setBaseLimit(ruleData.daily_limit_min ?? 120)
        const dow = ruleData.daily_limits_by_dow ?? {}
        const hasOverrides = Object.keys(dow).length > 0
        setSameEveryDay(!hasOverrides)
        setByDow(Object.fromEntries(DAYS.map((_, i) => [String(i), dow[String(i)] ?? ruleData.daily_limit_min ?? 120])))
        setLimitAction(ruleData.limit_action ?? 'lock_navigation')
        setAlertOnLimit(ruleData.alert_on_limit ?? true)
      } else {
        setByDow(Object.fromEntries(DAYS.map((_, i) => [String(i), 120])))
      }
    } catch (error) {
      toast.error('Could not load usage', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast, historyDays])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  const save = async () => {
    setSaving(true)
    try {
      const base = clamp(baseLimit, 0, 1440)
      const overrides = sameEveryDay
        ? null
        : Object.fromEntries(Object.entries(byDow).map(([d, v]) => [d, clamp(v, 0, 1440)]))
      await upsertScreenTimeRule({
        childId,
        dailyLimitMin: base,
        isEnabled: enabled,
        dailyLimitsByDow: overrides,
        limitAction,
        alertOnLimit,
      })
      toast.success('Daily limits saved')
      await load()
    } catch (error) {
      toast.error('Could not save limits', error.message)
    } finally {
      setSaving(false)
    }
  }

  const todayDow = new Date().getDay()
  const totalMs = usage.reduce((sum, u) => sum + (u.total_foreground_ms || 0), 0)
  const maxMs = usage.length ? usage[0].total_foreground_ms || 1 : 1
  const todayLimitMin = limitForDay(rule, todayDow)
  const limitMs = (todayLimitMin ?? 0) * 60 * 1000
  const progress = limitMs > 0 ? Math.min(100, Math.round((totalMs / limitMs) * 100)) : 0
  const overLimit = todayLimitMin !== null && totalMs >= limitMs

  const chartData = useMemo(() => history.map((d) => {
    const date = new Date(`${d.date}T00:00:00`)
    const lim = limitForDay(rule, date.getDay())
    return {
      label: historyDays <= 7 ? DAYS[date.getDay()] : `${date.getDate()}/${date.getMonth() + 1}`,
      minutes: Math.round(d.totalMs / 60_000),
      limit: lim,
      over: lim !== null && d.totalMs >= lim * 60_000,
    }
  }), [history, rule, historyDays])
  const avgMinutes = chartData.length ? Math.round(chartData.reduce((s, d) => s + d.minutes, 0) / chartData.length) : 0

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

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
              <p className="text-xs text-secondary-token">Screen time today</p>
              <p className="text-2xl font-extrabold text-primary-token">
                {formatDuration(totalMs)}
                {todayLimitMin !== null && (
                  <span className="text-sm font-medium text-muted-token"> / {formatMinutes(todayLimitMin)}</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-xl text-muted-token hover:text-saffron-500 hover:bg-saffron-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </CardBody>
        {todayLimitMin !== null && (
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={overLimit ? 'text-red-600 font-semibold' : 'text-secondary-token'}>
                {overLimit ? "Today's limit reached" : `${progress}% of today's limit · ${formatMinutes(todayLimitMin - Math.round(totalMs / 60_000))} left`}
              </span>
              <span className="text-muted-token">{DAYS[todayDow]} limit: {formatMinutes(todayLimitMin)}</span>
            </div>
            <div className="h-2 w-full bg-[var(--surface-muted)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${overLimit ? 'bg-red-500' : 'bg-saffron-500'}`}
                style={{ width: `${todayLimitMin === 0 ? 100 : progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* History chart */}
      <Card>
        <CardBody className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-primary-token">Screen time history</p>
              <p className="text-xs text-muted-token">Average {formatMinutes(avgMinutes)} per day</p>
            </div>
            <div className="flex items-center gap-1 bg-[var(--surface-muted)] rounded-lg p-0.5">
              {[7, 14, 30].map((n) => (
                <button
                  key={n}
                  onClick={() => setHistoryDays(n)}
                  className={cn('px-2.5 py-1 rounded-md text-xs font-medium', historyDays === n ? 'bg-white shadow text-indigo-600' : 'text-secondary-token')}
                >
                  {n}d
                </button>
              ))}
            </div>
          </div>
          {chartData.every((d) => d.minutes === 0) ? (
            <p className="text-xs text-muted-token text-center py-8">No usage reported for this period yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={historyDays > 14 ? 3 : 0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`)} />
                <Tooltip formatter={(v) => [formatMinutes(v), 'Screen time']} />
                {todayLimitMin !== null && sameEveryDay && (
                  <ReferenceLine y={todayLimitMin} stroke="#ef4444" strokeDasharray="4 4" />
                )}
                <Bar dataKey="minutes" radius={[6, 6, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.over ? '#ef4444' : '#6366f1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      {/* Daily limits editor */}
      <Card>
        <CardBody className="py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary-token">
              <Hourglass className="w-4 h-4 text-saffron-500" />
              Daily time limits
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
              title={enabled ? 'Limits on' : 'Limits off'}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-[var(--surface-muted)] rounded-xl p-1 w-fit">
            <button
              onClick={() => setSameEveryDay(true)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', sameEveryDay ? 'bg-indigo-600 text-white' : 'text-secondary-token')}
            >
              Same every day
            </button>
            <button
              onClick={() => setSameEveryDay(false)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', !sameEveryDay ? 'bg-indigo-600 text-white' : 'text-secondary-token')}
            >
              Per weekday
            </button>
          </div>

          {sameEveryDay ? (
            <div className="space-y-2">
              <MinutesField value={baseLimit} onChange={setBaseLimit} disabled={!enabled} />
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setBaseLimit(p)}
                    className={cn('px-2.5 py-1 text-xs rounded-lg border', Number(baseLimit) === p ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-[var(--border-color)] text-secondary-token hover:bg-[var(--surface-muted)]')}
                  >
                    {formatMinutes(p)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {DAYS.map((day, i) => (
                <div key={day} className="flex items-center justify-between gap-3">
                  <span className={cn('text-sm w-10', i === todayDow ? 'font-semibold text-indigo-600' : 'text-primary-token')}>{day}</span>
                  <MinutesField
                    value={byDow[String(i)] ?? baseLimit}
                    onChange={(v) => setByDow((prev) => ({ ...prev, [String(i)]: v }))}
                    disabled={!enabled}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-token uppercase tracking-wide mb-2">When the limit is reached</p>
            <div className="grid grid-cols-1 gap-2">
              {LIMIT_ACTIONS.map((act) => {
                const Icon = act.icon
                return (
                  <button
                    key={act.value}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setLimitAction(act.value)}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border text-left text-sm transition-colors disabled:opacity-50',
                      limitAction === act.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-[var(--border-color)] hover:border-slate-300 text-primary-token',
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <span className="font-medium">{act.label}</span>
                      <p className="text-xs opacity-70">{act.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm text-primary-token">Alert me when the limit is reached</span>
            <button
              type="button"
              onClick={() => setAlertOnLimit((v) => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${alertOnLimit ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${alertOnLimit ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          <p className="flex items-start gap-1.5 text-xs text-muted-token">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Screen time counts every app except the launcher and VOICE itself. Needs "Usage access" granted on the child device (setup checklist). Extra time you grant pauses the limit until it expires.
          </p>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-saffron-500 text-white text-sm font-medium hover:bg-saffron-600 disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save limits'}
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Per-app breakdown */}
      {usage.length === 0 ? (
        <div className="text-center py-10 px-6">
          <Smartphone className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">No usage data yet</p>
          <p className="text-xs text-muted-token mt-1 max-w-xs mx-auto">
            Usage appears once the child's device reports it. Make sure
            <span className="font-medium"> Usage access </span>
            is enabled on the device (VOICE app → setup checklist → "Allow Usage access").
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary-token">Apps used today</p>
          {usage.map((app, i) => {
            const pct = Math.max(4, Math.round(((app.total_foreground_ms || 0) / maxMs) * 100))
            return (
              <Card key={app.id}>
                <CardBody className="py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-primary-token truncate">{app.app_name || app.package_name}</p>
                      <p className="text-xs text-muted-token truncate font-mono">{app.package_name}</p>
                    </div>
                    <span className="text-sm font-semibold text-primary-token whitespace-nowrap">
                      {formatDuration(app.total_foreground_ms)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--surface-muted)] rounded-full overflow-hidden">
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
