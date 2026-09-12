/**
 * SummaryTab.jsx — the child's "at a glance" dashboard (Qustodio-style):
 * today's screen time vs. limit, the week, top apps, top websites and
 * searches, blocked attempts, last location, and a chronological activity
 * timeline stitched together from alerts + web activity.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock, Smartphone, Globe, Search, Ban, MapPin, RefreshCw, Hourglass, ShieldAlert, ShieldOff, Bell, Gift, Lock, Wifi, WifiOff,
  CheckCircle2, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from 'recharts'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import {
  getTodayUsage, getScreenTimeRule, getUsageHistory, listAlerts, listWebActivity, getLatestLocation, listDevices,
} from '@/lib/parentalControlApi'
import { limitForDay, formatMinutes } from '@/lib/screenTimePolicy'
import { isDeviceOnline } from '@/lib/commandStatus'
import { cn } from '@/lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ALERT_ICONS = {
  sos: ShieldAlert, geofence_enter: MapPin, geofence_exit: MapPin, screen_time_exceeded: Hourglass,
  app_time_limit_exceeded: Clock, blocked_app_attempt: Ban, website_blocked: Ban, website_alert: Globe,
  app_opened: Smartphone, device_offline: WifiOff, bonus_time_requested: Gift, tamper_detected: ShieldOff,
  device_enrolled: Smartphone,
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function SummaryTab({ childId, child, onNavigateTab }) {
  const toast = useToastStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [usage, setUsage] = useState([])
  const [rule, setRule] = useState(null)
  const [history, setHistory] = useState([])
  const [alerts, setAlerts] = useState([])
  const [web, setWeb] = useState([])
  const [location, setLocation] = useState(null)
  const [devices, setDevices] = useState([])

  const load = useCallback(async () => {
    try {
      const [u, r, h, a, w, loc, devs] = await Promise.all([
        getTodayUsage(childId).catch(() => []),
        getScreenTimeRule(childId).catch(() => null),
        getUsageHistory(childId, { days: 7 }).catch(() => []),
        listAlerts(childId, { limit: 40 }).catch(() => []),
        listWebActivity(childId, { limit: 60 }).catch(() => []),
        getLatestLocation(childId).catch(() => null),
        listDevices(childId).catch(() => []),
      ])
      setUsage(u); setRule(r); setHistory(h); setAlerts(a); setWeb(w); setLocation(loc); setDevices(devs)
    } catch (error) {
      toast.error('Could not load summary', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const todayDow = new Date().getDay()
  const totalMs = usage.reduce((s, u) => s + (u.total_foreground_ms || 0), 0)
  const totalMin = Math.round(totalMs / 60_000)
  const limitMin = limitForDay(rule, todayDow)
  const pct = limitMin ? Math.min(100, Math.round((totalMin / limitMin) * 100)) : 0
  const overLimit = limitMin !== null && totalMin >= limitMin

  const todayStart = new Date().setHours(0, 0, 0, 0)
  const todayAlerts = alerts.filter((a) => new Date(a.occurred_at).getTime() >= todayStart)
  const todayWeb = web.filter((w) => new Date(w.occurred_at).getTime() >= todayStart)
  const blockedToday = todayAlerts.filter((a) => a.alert_type === 'blocked_app_attempt' || a.alert_type === 'website_blocked')
  const searchesToday = todayWeb.filter((w) => w.activity_type === 'search')

  const domainCounts = {}
  for (const w of todayWeb) if (w.activity_type === 'visit' && w.domain) domainCounts[w.domain] = (domainCounts[w.domain] ?? 0) + 1
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const chartData = history.map((d) => {
    const date = new Date(`${d.date}T00:00:00`)
    const lim = limitForDay(rule, date.getDay())
    return { label: DAYS[date.getDay()], minutes: Math.round(d.totalMs / 60_000), over: lim !== null && d.totalMs >= lim * 60_000 }
  })

  const timeline = [
    ...todayAlerts.map((a) => ({ id: `a-${a.id}`, at: a.occurred_at, kind: 'alert', type: a.alert_type, title: a.title, body: a.body, severity: a.severity })),
    ...todayWeb.slice(0, 30).map((w) => ({
      id: `w-${w.id}`, at: w.occurred_at, kind: 'web', type: w.activity_type,
      title: w.activity_type === 'search' ? `Searched "${w.search_query}"` : `Visited ${w.domain}`,
      body: w.activity_type === 'search' ? `${w.search_engine ?? 'Search'} · ${w.domain}` : null,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 25)

  const activeDevices = devices.filter((d) => d.is_active)
  const onlineCount = activeDevices.filter((d) => isDeviceOnline(d)).length
  const anyState = activeDevices.find((d) => d.enforcement_state)?.enforcement_state
  // The parent's own lock/pause are desired state on the child row
  // (migration 72); only automatic locks come from the device's report.
  const parentLocked = child?.parent_lock_active ?? anyState?.lock_reason === 'parent_lock'
  const autoLock = anyState?.lock_reason && anyState.lock_reason !== 'parent_lock' ? anyState.lock_reason : null
  const lockReason = parentLocked ? 'parent_lock' : autoLock
  const internetPaused = child?.internet_pause_active ?? Boolean(anyState?.manual_internet_pause ?? anyState?.internet_paused)
  const setupIssues = activeDevices.filter((d) => {
    const s = d.enforcement_state
    return s && (s.device_admin === false || s.accessibility_enabled === false || s.usage_access === false)
  })

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-5">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={onlineCount > 0 ? 'tulasi' : 'default'} dot>
          {onlineCount > 0 ? `${onlineCount} device${onlineCount === 1 ? '' : 's'} online` : activeDevices.length ? 'Devices offline' : 'No devices'}
        </Badge>
        {lockReason && (
          <Badge variant="red">
            <Lock className="w-3.5 h-3.5 mr-1" />
            {lockReason === 'daily_limit' ? 'Locked — daily limit' : lockReason === 'restricted_time' ? 'Locked — restricted time' : lockReason === 'parent_lock' ? 'Locked by you' : `Locked — ${anyState?.active_schedule ?? 'routine'}`}
          </Badge>
        )}
        {internetPaused && <Badge variant="yellow"><WifiOff className="w-3.5 h-3.5 mr-1" /> Internet paused</Badge>}
        {!internetPaused && onlineCount > 0 && !lockReason && <Badge variant="default"><Wifi className="w-3.5 h-3.5 mr-1" /> Internet on</Badge>}
        <button onClick={() => { setRefreshing(true); load() }} className="ml-auto p-2 rounded-lg text-muted-token hover:text-indigo-600" title="Refresh">
          <RefreshCw className={cn('w-5 h-5', refreshing && 'animate-spin')} />
        </button>
      </div>

      {setupIssues.length > 0 && (
        <button onClick={() => onNavigateTab?.('devices')} className="w-full rounded-3xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3 text-left">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800 flex-1">
            <span className="font-semibold">Setup incomplete on {setupIssues.length === 1 ? setupIssues[0].device_name || 'a device' : `${setupIssues.length} devices`}.</span>{' '}
            Some rules can't be enforced until Device Admin, Accessibility and Usage access are all turned on. Tap to see what's missing.
          </p>
          <ChevronRight className="w-5 h-5 text-amber-600" />
        </button>
      )}

      {/* Screen time today + week */}
      <Card>
        <CardBody className="py-5">
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-sm text-secondary-token">Screen time today</p>
              <p className="text-4xl font-extrabold text-primary-token">
                {formatMinutes(totalMin)}
                {limitMin !== null && <span className="text-base font-medium text-muted-token"> / {formatMinutes(limitMin)}</span>}
              </p>
              {limitMin !== null ? (
                <p className={cn('text-sm mt-2', overLimit ? 'text-red-600 font-semibold' : 'text-secondary-token')}>
                  {overLimit ? "Today's limit reached" : `${formatMinutes(limitMin - totalMin)} left today`}
                </p>
              ) : (
                <button onClick={() => onNavigateTab?.('usage')} className="text-sm text-indigo-600 mt-2 hover:underline">No daily limit set — add one</button>
              )}
            </div>
            <div className="w-44 h-24">
              {chartData.some((d) => d.minutes > 0) && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [formatMinutes(v), 'Screen time']} cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                      {chartData.map((d, i) => <Cell key={i} fill={d.over ? '#ef4444' : i === chartData.length - 1 ? '#6366f1' : '#c7d2fe'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {limitMin !== null && (
            <div className="h-2.5 w-full bg-[var(--surface-muted)] rounded-full overflow-hidden mt-4">
              <div className={cn('h-full rounded-full', overLimit ? 'bg-red-500' : 'bg-indigo-500')} style={{ width: `${limitMin === 0 ? 100 : pct}%` }} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => onNavigateTab?.('rules')} className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-4 text-left">
          <Smartphone className="w-5 h-5 text-indigo-500 mb-2" />
          <p className="text-2xl font-bold text-primary-token">{usage.length}</p>
          <p className="text-xs text-muted-token">apps used</p>
        </button>
        <button onClick={() => onNavigateTab?.('webActivity')} className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-4 text-left">
          <Globe className="w-5 h-5 text-blue-500 mb-2" />
          <p className="text-2xl font-bold text-primary-token">{topDomains.length}<span className="text-sm font-medium text-muted-token"> sites</span></p>
          <p className="text-xs text-muted-token">{searchesToday.length} search{searchesToday.length === 1 ? '' : 'es'}</p>
        </button>
        <button onClick={() => onNavigateTab?.('alerts')} className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-4 text-left">
          <Ban className={cn('w-5 h-5 mb-2', blockedToday.length ? 'text-red-500' : 'text-muted-token')} />
          <p className="text-2xl font-bold text-primary-token">{blockedToday.length}</p>
          <p className="text-xs text-muted-token">blocked attempts</p>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top apps */}
        <Card>
          <CardBody className="py-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-primary-token">Top apps today</p>
              <button onClick={() => onNavigateTab?.('rules')} className="text-sm text-indigo-600 hover:underline">Manage</button>
            </div>
            {usage.length === 0 ? (
              <p className="text-sm text-muted-token py-4">No app usage reported yet today.</p>
            ) : (
              <div className="space-y-3">
                {usage.slice(0, 5).map((app) => {
                  const w = Math.max(4, Math.round(((app.total_foreground_ms || 0) / (usage[0].total_foreground_ms || 1)) * 100))
                  return (
                    <div key={app.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate text-primary-token">{app.app_name || app.package_name}</span>
                        <span className="text-xs text-secondary-token whitespace-nowrap ml-2">{formatMinutes(Math.round((app.total_foreground_ms || 0) / 60_000))}</span>
                      </div>
                      <div className="h-2 bg-[var(--surface-muted)] rounded-full overflow-hidden mt-1.5">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${w}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Web */}
        <Card>
          <CardBody className="py-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-primary-token">Web today</p>
              <button onClick={() => onNavigateTab?.('websites')} className="text-sm text-indigo-600 hover:underline">Filters</button>
            </div>
            {topDomains.length === 0 && searchesToday.length === 0 ? (
              <p className="text-sm text-muted-token py-4">No browsing seen yet today (needs Accessibility enabled on the device).</p>
            ) : (
              <div className="space-y-2">
                {topDomains.map(([domain, n]) => (
                  <div key={domain} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 truncate text-primary-token"><Globe className="w-4 h-4 text-muted-token flex-shrink-0" />{domain}</span>
                    <span className="text-xs text-muted-token">{n}×</span>
                  </div>
                ))}
                {searchesToday.slice(0, 3).map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm text-secondary-token truncate">
                    <Search className="w-4 h-4 text-muted-token flex-shrink-0" /> "{s.search_query}"
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Location */}
      <Card hover onClick={() => onNavigateTab?.('location')}>
        <CardBody className="py-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-6 h-6 text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary-token">Last known location</p>
            <p className="text-sm text-muted-token truncate">
              {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} · ${timeAgo(location.recorded_at)}` : 'No location reported yet'}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-token" />
        </CardBody>
      </Card>

      {/* Timeline */}
      <Card>
        <CardBody className="py-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-primary-token">Today's activity</p>
            <button onClick={() => onNavigateTab?.('alerts')} className="text-sm text-indigo-600 hover:underline">All alerts</button>
          </div>
          {timeline.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-muted-token mx-auto mb-3" />
              <p className="text-sm text-muted-token">Nothing to report yet today.</p>
            </div>
          ) : (
            <ol className="relative border-l border-[var(--border-color)] ml-2 space-y-4">
              {timeline.map((item) => {
                const Icon = item.kind === 'web' ? (item.type === 'search' ? Search : Globe) : (ALERT_ICONS[item.type] ?? Bell)
                const tone = item.kind === 'alert'
                  ? item.severity === 'critical' ? 'text-red-600 bg-red-50' : item.severity === 'warning' ? 'text-amber-600 bg-amber-50' : 'text-indigo-600 bg-indigo-50'
                  : 'text-slate-500 bg-slate-100'
                return (
                  <li key={item.id} className="ml-4">
                    <span className={cn('absolute -left-[15px] w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-[var(--surface)]', tone)}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="pl-2">
                      <p className="text-sm text-primary-token">{item.title}</p>
                      <p className="text-xs text-muted-token">{fmtTime(item.at)}{item.body ? ` · ${item.body}` : ''}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-muted-token text-center">
        Tip: use the buttons above the tabs to pause internet, lock the device, or give extra time right now.{' '}
        <button onClick={() => navigate('/parental-control')} className="text-indigo-600 hover:underline">Family dashboard</button>
      </p>
    </div>
  )
}
