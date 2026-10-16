/**
 * SummaryTab.jsx — the child's "at a glance" dashboard: today's screen time
 * vs. limit, the week, top apps, web, blocked attempts, last location and a
 * timeline stitched together from alerts + web activity.
 *
 * Lock / pause / online status live in the page header and CommandCenter
 * above this tab; they are deliberately not repeated here.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Clock, Smartphone, Globe, Search, Ban, MapPin, Hourglass, ShieldAlert, ShieldOff, Bell, Gift, WifiOff,
  CheckCircle2, AlertTriangle, ChevronRight, Navigation,
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from 'recharts'
import Card from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/States'
import { useToast } from '@/store/toastStore'
import { friendlyError } from '@/lib/friendlyError'
import {
  getTodayUsage, getScreenTimeRule, getUsageHistory, listAlerts, listWebActivity, getLatestLocation,
} from '@/lib/parentalControlApi'
import { limitForDay, formatMinutes } from '@/lib/screenTimePolicy'
import { localDateISO } from '@/lib/dates'
import { cn } from '@/lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ALERT_ICONS = {
  sos: ShieldAlert, geofence_enter: MapPin, geofence_exit: MapPin, screen_time_exceeded: Hourglass,
  app_time_limit_exceeded: Clock, blocked_app_attempt: Ban, website_blocked: Ban, website_alert: Globe,
  app_opened: Smartphone, device_offline: WifiOff, bonus_time_requested: Gift, tamper_detected: ShieldOff,
  device_enrolled: Smartphone,
}

function timeAgo(iso) {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleDateString()
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * One row per app. A child with two phones has one usage row per app PER
 * DEVICE; listing them raw showed the same app twice and inflated "apps used".
 */
function aggregateUsage(rows) {
  const byPkg = new Map()
  for (const r of rows) {
    const cur = byPkg.get(r.package_name)
    if (cur) cur.ms += r.total_foreground_ms || 0
    else byPkg.set(r.package_name, { pkg: r.package_name, name: r.app_name || r.package_name, ms: r.total_foreground_ms || 0 })
  }
  return [...byPkg.values()].filter((a) => a.ms > 0).sort((a, b) => b.ms - a.ms)
}

/**
 * The phone's own count of today's screen time (PolicyEnforcer.kt) — the
 * number the daily limit is actually enforced against, reported whenever it
 * changes. Only trusted when the report is from today on the parent's clock.
 */
function liveScreenTime(devices) {
  const today = localDateISO()
  let best = null
  for (const d of devices ?? []) {
    const s = d.enforcement_state
    if (!d.is_active || !s || s.screen_time_today_min == null) continue
    const at = s.reported_at ?? d.last_enforcement_at
    if (!at || localDateISO(new Date(at)) !== today) continue
    if (!best || s.screen_time_today_min > best.min) best = { min: s.screen_time_today_min, at }
  }
  return best
}

function SectionCard({ title, action, onAction, children, className }) {
  return (
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-heading text-primary-token">{title}</h3>
        {action && (
          <button type="button" onClick={onAction} className="text-sm font-semibold text-[var(--color-primary)] h-8 px-1">
            {action}
          </button>
        )}
      </div>
      {children}
    </Card>
  )
}

function StatTile({ icon: Icon, value, label, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press rounded-[var(--radius-lg)] border border-[var(--border-color)] bg-[var(--surface)] p-3.5 text-left"
    >
      <Icon className={cn('w-5 h-5 mb-2', tone ?? 'text-[var(--color-primary)]')} aria-hidden="true" />
      <p className="text-2xl font-bold text-primary-token tabular leading-none">{value}</p>
      <p className="text-xs text-muted-token mt-1">{label}</p>
    </button>
  )
}

export default function SummaryTab({ childId, child, devices = [], onNavigateTab }) {
  const toast = useToast()
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    try {
      const [usage, rule, history, alerts, web, location] = await Promise.all([
        getTodayUsage(childId).catch(() => []),
        getScreenTimeRule(childId).catch(() => null),
        getUsageHistory(childId, { days: 7 }).catch(() => []),
        listAlerts(childId, { limit: 40 }).catch(() => []),
        listWebActivity(childId, { limit: 60 }).catch(() => []),
        getLatestLocation(childId).catch(() => null),
      ])
      setData({ usage, rule, history, alerts, web, location })
    } catch (error) {
      toast.error('Could not load the overview', friendlyError(error))
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    // Usage arrives from the phone every ~15 min; keep the page current
    // while it is open without the parent hunting for a refresh button.
    const poll = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60_000)
    return () => { clearTimeout(id); clearInterval(poll) }
  }, [load])

  const apps = useMemo(() => aggregateUsage(data?.usage ?? []), [data])
  const live = useMemo(() => liveScreenTime(devices), [devices])

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-40 rounded-[var(--radius-lg)]" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
        </div>
        <Skeleton className="h-48 rounded-[var(--radius-lg)]" />
      </div>
    )
  }

  const { rule, history, alerts, web, location } = data
  const todayDow = new Date().getDay()
  const reportedMin = Math.round(apps.reduce((s, a) => s + a.ms, 0) / 60_000)
  const totalMin = live ? live.min : reportedMin
  const updatedAt = live?.at ?? data.usage.reduce((m, r) => (r.reported_at && r.reported_at > (m ?? '') ? r.reported_at : m), null)
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

  const chartData = history.map((d, i) => {
    const date = new Date(`${d.date}T00:00:00`)
    const lim = limitForDay(rule, date.getDay())
    const isToday = i === history.length - 1
    const minutes = isToday ? totalMin : Math.round(d.totalMs / 60_000)
    return { label: DAYS[date.getDay()], minutes, over: lim !== null && minutes >= lim, isToday }
  })

  const timeline = [
    ...todayAlerts.map((a) => ({ id: `a-${a.id}`, at: a.occurred_at, kind: 'alert', type: a.alert_type, title: a.title, body: a.body, severity: a.severity })),
    ...todayWeb.slice(0, 30).map((w) => ({
      id: `w-${w.id}`, at: w.occurred_at, kind: 'web', type: w.activity_type,
      title: w.activity_type === 'search' ? `Searched “${w.search_query}”` : `Visited ${w.domain}`,
      body: w.activity_type === 'search' ? `${w.search_engine ?? 'Search'} · ${w.domain}` : null,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 25)

  const setupIssues = devices.filter((d) => {
    const s = d.is_active && d.enforcement_state
    return s && (s.device_admin === false || s.accessibility_enabled === false || s.usage_access === false)
  })
  const noUsageAccess = devices.some((d) => d.is_active && d.enforcement_state?.usage_access === false)

  return (
    <div className="space-y-4">
      {setupIssues.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigateTab?.('devices')}
          className="press w-full rounded-[var(--radius-lg)] p-4 flex items-center gap-3 text-left bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm flex-1">
            <span className="font-semibold">Setup isn’t finished on {setupIssues.length === 1 ? setupIssues[0].device_name || 'the phone' : `${setupIssues.length} phones`}.</span>{' '}
            Some rules can’t work yet. Tap to see what’s missing.
          </p>
          <ChevronRight className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        </button>
      )}

      {/* Screen time today + week */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-overline">Screen time today</p>
            <p className="text-display text-primary-token tabular mt-1">
              {formatMinutes(totalMin)}
              {limitMin !== null && <span className="text-heading font-medium text-muted-token"> / {formatMinutes(limitMin)}</span>}
            </p>
            {noUsageAccess ? (
              <p className="text-sm mt-1.5 text-[var(--color-warning)]">Usage access is off on the phone, so time can’t be measured.</p>
            ) : limitMin !== null ? (
              <p className={cn('text-sm mt-1.5', overLimit ? 'text-[var(--color-danger)] font-semibold' : 'text-secondary-token')}>
                {overLimit ? 'Today’s limit reached' : `${formatMinutes(limitMin - totalMin)} left today`}
              </p>
            ) : (
              <button type="button" onClick={() => onNavigateTab?.('usage')} className="text-sm font-semibold text-[var(--color-primary)] mt-1.5">
                Set a daily limit
              </button>
            )}
            {updatedAt && <p className="text-xs text-muted-token mt-1">Updated {timeAgo(updatedAt)}</p>}
          </div>
          {chartData.some((d) => d.minutes > 0) && (
            <div className="w-40 sm:w-48 h-24 flex-shrink-0" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => [formatMinutes(v), 'Screen time']} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => {
                      // Inline style: var() isn't reliable in SVG presentation attributes.
                      const fill = d.over ? 'var(--color-danger)' : d.isToday ? 'var(--color-primary)' : 'var(--color-primary-200)'
                      return <Cell key={i} fill={fill} style={{ fill }} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        {limitMin !== null && (
          <div className="h-2.5 w-full bg-[var(--surface-muted)] rounded-full overflow-hidden mt-4" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn('h-full rounded-full transition-[width]', overLimit ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-primary)]')} style={{ width: `${limitMin === 0 ? 100 : pct}%` }} />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={Smartphone} value={apps.length} label="apps used" onClick={() => onNavigateTab?.('rules')} />
        <StatTile icon={Globe} value={topDomains.length} label={`sites · ${searchesToday.length} search${searchesToday.length === 1 ? '' : 'es'}`} tone="text-[var(--color-info)]" onClick={() => onNavigateTab?.('webActivity')} />
        <StatTile icon={Ban} value={blockedToday.length} label="blocked tries" tone={blockedToday.length ? 'text-[var(--color-danger)]' : 'text-muted-token'} onClick={() => onNavigateTab?.('alerts')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Top apps today" action="Manage" onAction={() => onNavigateTab?.('rules')}>
          {apps.length === 0 ? (
            <p className="text-sm text-muted-token py-3">No app use reported yet today.</p>
          ) : (
            <ul className="space-y-3">
              {apps.slice(0, 5).map((app) => {
                const w = Math.max(4, Math.round((app.ms / (apps[0].ms || 1)) * 100))
                return (
                  <li key={app.pkg}>
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate text-primary-token">{app.name}</span>
                      <span className="text-xs text-secondary-token whitespace-nowrap tabular">{formatMinutes(Math.round(app.ms / 60_000))}</span>
                    </div>
                    <div className="h-1.5 bg-[var(--surface-muted)] rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-[var(--color-primary)] rounded-full opacity-70" style={{ width: `${w}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Web today" action="Filters" onAction={() => onNavigateTab?.('websites')}>
          {topDomains.length === 0 && searchesToday.length === 0 ? (
            <p className="text-sm text-muted-token py-3">No browsing seen yet today. This needs Accessibility on the phone.</p>
          ) : (
            <ul className="space-y-2">
              {topDomains.map(([domain, n]) => (
                <li key={domain} className="flex items-center justify-between text-sm gap-2">
                  <span className="flex items-center gap-2 truncate text-primary-token"><Globe className="w-4 h-4 text-muted-token flex-shrink-0" />{domain}</span>
                  <span className="text-xs text-muted-token tabular">{n}×</span>
                </li>
              ))}
              {searchesToday.slice(0, 3).map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm text-secondary-token truncate">
                  <Search className="w-4 h-4 text-muted-token flex-shrink-0" /> “{s.search_query}”
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <Card hover as="button" type="button" onClick={() => onNavigateTab?.('location')} className="w-full text-left p-4 flex items-center gap-4">
        <span className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] flex items-center justify-center flex-shrink-0">
          <MapPin className="w-6 h-6 text-[var(--color-primary)]" aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-primary-token">
            {location ? `${child?.display_name ?? 'Your child'} was here ${timeAgo(location.recorded_at)}` : 'Location'}
          </span>
          <span className="block text-sm text-muted-token truncate">
            {location ? 'Tap to see the map and places' : 'No location reported yet'}
          </span>
        </span>
        {location ? <Navigation className="w-5 h-5 text-muted-token" aria-hidden="true" /> : <ChevronRight className="w-5 h-5 text-muted-token" aria-hidden="true" />}
      </Card>

      <SectionCard title="Today’s activity" action="All alerts" onAction={() => onNavigateTab?.('alerts')}>
        {timeline.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-8 h-8 text-[var(--color-success)] mx-auto mb-2 opacity-70" aria-hidden="true" />
            <p className="text-sm text-muted-token">All quiet today.</p>
          </div>
        ) : (
          <ol className="relative border-l border-[var(--border-color)] ml-3 space-y-4">
            {timeline.map((item) => {
              const Icon = item.kind === 'web' ? (item.type === 'search' ? Search : Globe) : (ALERT_ICONS[item.type] ?? Bell)
              const tone = item.kind === 'alert'
                ? item.severity === 'critical'
                  ? 'text-[var(--color-danger)] bg-[var(--color-danger-soft)]'
                  : item.severity === 'warning'
                    ? 'text-[var(--color-warning)] bg-[var(--color-warning-soft)]'
                    : 'text-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                : 'text-muted-token bg-[var(--surface-muted)]'
              return (
                <li key={item.id} className="ml-5 relative">
                  <span className={cn('absolute -left-[34px] top-0 w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-[var(--surface)]', tone)}>
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <p className="text-sm text-primary-token">{item.title}</p>
                  <p className="text-xs text-muted-token">{fmtTime(item.at)}{item.body ? ` · ${item.body}` : ''}</p>
                </li>
              )
            })}
          </ol>
        )}
      </SectionCard>
    </div>
  )
}
