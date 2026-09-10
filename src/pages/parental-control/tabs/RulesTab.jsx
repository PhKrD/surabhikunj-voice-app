/**
 * RulesTab.jsx — "Games & Apps" (Qustodio-style).
 *
 * Every app installed on the child's devices is listed with today's usage
 * and a per-app status the parent taps to change: Allowed (default, no
 * rule) / Time limit / Blocked, plus an "alert me when used" bell. Rules
 * are child-wide (device_id NULL) and enforced natively by
 * PolicyEnforcer.kt + VoiceKidsAccessibilityService (no factory reset).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Smartphone as SmartphoneIcon, Clock, Ban, CheckCircle2, Bell, BellOff, X, Info, RefreshCw } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listAppRules, setAppRule, listInstalledApps, getAppUsageToday } from '@/lib/parentalControlApi'
import { isProtectedPackage, PROTECTED_PACKAGE_EXPLANATION } from '@/lib/protectedPackages'
import { appLimitForDay, formatMinutes } from '@/lib/screenTimePolicy'
import { cn } from '@/lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PRESETS = [15, 30, 45, 60, 90, 120]

const STATUS_META = {
  allow: { label: 'Allowed', variant: 'tulasi', icon: CheckCircle2 },
  time_limit: { label: 'Time limit', variant: 'yellow', icon: Clock },
  block: { label: 'Blocked', variant: 'red', icon: Ban },
}

// Packages that are noise in a "Games & Apps" list (system plumbing with a
// launcher icon but nothing a parent would ever want to rule on).
const HIDDEN_PREFIXES = ['com.android.', 'com.google.android.gms', 'com.google.android.gsf', 'com.qualcomm.', 'com.samsung.android.']

function isNoise(app) {
  if (isProtectedPackage(app.package_name)) return true
  if (!app.is_system_app) return false
  return HIDDEN_PREFIXES.some((p) => app.package_name.startsWith(p))
}

/** Modal for configuring a per-app time limit (same every day or per weekday). */
function TimeLimitModal({ app, rule, onClose, onSave }) {
  const [base, setBase] = useState(rule?.daily_limit_min ?? 60)
  const [perDay, setPerDay] = useState(Boolean(rule?.daily_limits_by_dow && Object.keys(rule.daily_limits_by_dow).length))
  const [byDow, setByDow] = useState(() => Object.fromEntries(DAYS.map((_, i) => [String(i), rule?.daily_limits_by_dow?.[String(i)] ?? rule?.daily_limit_min ?? 60])))
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await onSave({
        dailyLimitMin: Math.max(1, Number(base) || 60),
        dailyLimitsByDow: perDay ? Object.fromEntries(Object.entries(byDow).map(([d, v]) => [d, Math.max(0, Number(v) || 0)])) : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardBody className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-primary-token">Daily time limit</h3>
              <p className="text-xs text-muted-token">{app.app_name || app.package_name}</p>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg text-muted-token hover:bg-[var(--surface-muted)]"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex items-center gap-2 bg-[var(--surface-muted)] rounded-xl p-1 w-fit">
            <button onClick={() => setPerDay(false)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', !perDay ? 'bg-indigo-600 text-white' : 'text-secondary-token')}>Same every day</button>
            <button onClick={() => setPerDay(true)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', perDay ? 'bg-indigo-600 text-white' : 'text-secondary-token')}>Per weekday</button>
          </div>

          {!perDay ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={1440} value={base} onChange={(e) => setBase(e.target.value)} className="w-24 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm" />
                <span className="text-sm text-secondary-token">minutes/day · {formatMinutes(base)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p} onClick={() => setBase(p)} className={cn('px-2.5 py-1 text-xs rounded-lg border', Number(base) === p ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-[var(--border-color)] text-secondary-token')}>{formatMinutes(p)}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-primary-token w-9">{d}</span>
                  <input type="number" min={0} max={1440} value={byDow[String(i)]} onChange={(e) => setByDow((prev) => ({ ...prev, [String(i)]: e.target.value }))} className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border-color)] text-sm text-right" />
                </label>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-token flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> The app is blocked for the rest of the day once the limit is used up. 0 minutes = blocked all day.</p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={submit}>Save limit</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export default function RulesTab({ childId }) {
  const toast = useToastStore()
  const [rules, setRules] = useState([])
  const [installedApps, setInstalledApps] = useState([])
  const [appUsage, setAppUsage] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | rules | blocked | limited
  const [showSystem, setShowSystem] = useState(false)
  const [busyPkg, setBusyPkg] = useState(null)
  const [limitModal, setLimitModal] = useState(null) // { app, rule }

  const load = useCallback(async () => {
    try {
      const [rulesData, appsData, usageData] = await Promise.all([
        listAppRules(childId),
        listInstalledApps(childId),
        getAppUsageToday(childId),
      ])
      setRules(rulesData)
      setInstalledApps(appsData)
      setAppUsage(usageData)
    } catch (error) {
      toast.error('Could not load apps', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  // Child-wide rule per package (device-specific rules are shown but not edited here).
  const ruleByPkg = useMemo(() => {
    const map = {}
    for (const r of rules) if (!r.device_id && r.is_enabled !== false) map[r.package_name] = r
    return map
  }, [rules])

  const usageByPkg = useMemo(() => {
    const map = {}
    for (const u of appUsage) map[u.package_name] = (map[u.package_name] ?? 0) + (u.total_foreground_ms || 0)
    return map
  }, [appUsage])

  // Merge installed apps across devices (dedupe by package) + any ruled
  // package not currently in the inventory (e.g. uninstalled app).
  const apps = useMemo(() => {
    const byPkg = {}
    for (const a of installedApps) {
      if (!byPkg[a.package_name]) byPkg[a.package_name] = { package_name: a.package_name, app_name: a.app_name, is_system_app: a.is_system_app }
    }
    for (const r of rules) {
      if (!byPkg[r.package_name]) byPkg[r.package_name] = { package_name: r.package_name, app_name: r.app_name, is_system_app: false, notInstalled: true }
    }
    const q = searchQuery.trim().toLowerCase()
    const todayDow = new Date().getDay()
    return Object.values(byPkg)
      .filter((a) => showSystem || !isNoise(a) || ruleByPkg[a.package_name])
      .filter((a) => !q || a.app_name?.toLowerCase().includes(q) || a.package_name.toLowerCase().includes(q))
      .map((a) => {
        const rule = ruleByPkg[a.package_name]
        const status = rule?.action ?? 'allow'
        const usedMs = usageByPkg[a.package_name] ?? 0
        const limitMin = rule?.action === 'time_limit' ? appLimitForDay(rule, todayDow) : null
        return { ...a, rule, status, usedMs, limitMin, alert: Boolean(rule?.alert_on_use) }
      })
      .filter((a) => {
        if (filter === 'rules') return Boolean(a.rule)
        if (filter === 'blocked') return a.status === 'block'
        if (filter === 'limited') return a.status === 'time_limit'
        return true
      })
      .sort((a, b) => {
        // ruled first, then most used today, then name
        const ra = a.rule ? 0 : 1
        const rb = b.rule ? 0 : 1
        if (ra !== rb) return ra - rb
        if (b.usedMs !== a.usedMs) return b.usedMs - a.usedMs
        return (a.app_name || a.package_name).localeCompare(b.app_name || b.package_name)
      })
  }, [installedApps, rules, ruleByPkg, usageByPkg, searchQuery, filter, showSystem])

  const applyRule = async (app, patch) => {
    if ((patch.action === 'block' || patch.action === 'time_limit') && isProtectedPackage(app.package_name)) {
      toast.error('Protected app', PROTECTED_PACKAGE_EXPLANATION)
      return
    }
    setBusyPkg(app.package_name)
    try {
      const current = app.rule
      await setAppRule({
        childId,
        packageName: app.package_name,
        appName: app.app_name,
        action: patch.action !== undefined ? patch.action : (current?.action ?? null),
        dailyLimitMin: patch.dailyLimitMin ?? current?.daily_limit_min ?? 60,
        dailyLimitsByDow: patch.dailyLimitsByDow !== undefined ? patch.dailyLimitsByDow : current?.daily_limits_by_dow ?? null,
        alertOnUse: patch.alertOnUse !== undefined ? patch.alertOnUse : Boolean(current?.alert_on_use),
      })
      await load()
    } catch (error) {
      let friendly = error.message
      if (/protected and cannot be blocked/.test(error.message)) friendly = PROTECTED_PACKAGE_EXPLANATION
      toast.error('Could not update app', friendly)
    } finally {
      setBusyPkg(null)
    }
  }

  const setStatus = (app, status) => {
    if (status === 'time_limit') {
      setLimitModal({ app, rule: app.rule })
      return
    }
    // "Allowed" with no alert = remove the rule entirely (default state).
    applyRule(app, { action: status === 'allow' ? (app.alert ? 'allow' : null) : status })
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  const counts = {
    blocked: Object.values(ruleByPkg).filter((r) => r.action === 'block').length,
    limited: Object.values(ruleByPkg).filter((r) => r.action === 'time_limit').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search apps..."
            className="w-full px-3 py-2.5 pl-10 rounded-xl border border-[var(--border-color)] text-sm"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
        </div>
        <button onClick={() => { setRefreshing(true); load() }} className="p-2.5 rounded-xl border border-[var(--border-color)] text-muted-token hover:text-indigo-600" title="Refresh">
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {[
          { key: 'all', label: `All (${apps.length})` },
          { key: 'rules', label: 'With rules' },
          { key: 'blocked', label: `Blocked (${counts.blocked})` },
          { key: 'limited', label: `Time limits (${counts.limited})` },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border', filter === f.key ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-[var(--surface)] text-secondary-token border-[var(--border-color)]')}
          >
            {f.label}
          </button>
        ))}
        <label className="flex-shrink-0 flex items-center gap-1.5 text-xs text-muted-token ml-auto cursor-pointer">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} className="rounded" />
          Show system apps
        </label>
      </div>

      {apps.length === 0 ? (
        <div className="text-center py-10 px-6">
          <SmartphoneIcon className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">
            {installedApps.length === 0 ? 'No apps reported yet' : 'No apps match'}
          </p>
          <p className="text-xs text-muted-token mt-1">
            {installedApps.length === 0
              ? "The child's device sends its app list shortly after pairing (and daily after that). Open VOICE on the device to sync now."
              : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map((app) => {
            const meta = STATUS_META[app.status] ?? STATUS_META.allow
            const busy = busyPkg === app.package_name
            const usedMin = Math.round(app.usedMs / 60_000)
            const overLimit = app.limitMin !== null && usedMin >= app.limitMin
            return (
              <Card key={app.package_name}>
                <CardBody className="py-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', app.status === 'block' ? 'bg-red-50' : app.status === 'time_limit' ? 'bg-amber-50' : 'bg-[var(--surface-muted)]')}>
                      <meta.icon className={cn('w-4 h-4', app.status === 'block' ? 'text-red-600' : app.status === 'time_limit' ? 'text-amber-600' : 'text-secondary-token')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-primary-token truncate">
                        {app.app_name || app.package_name}
                        {app.notInstalled && <span className="text-xs text-muted-token font-normal"> · not installed</span>}
                      </p>
                      <p className="text-xs text-muted-token truncate">
                        {app.usedMs > 0 ? `${formatMinutes(usedMin)} today` : 'Not used today'}
                        {app.limitMin !== null && (
                          <span className={overLimit ? 'text-red-600 font-medium' : ''}> · limit {formatMinutes(app.limitMin)}{overLimit ? ' — reached' : ''}</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => applyRule(app, { alertOnUse: !app.alert, action: app.rule?.action ?? (app.alert ? null : 'allow') })}
                      disabled={busy}
                      className={cn('p-2 rounded-lg', app.alert ? 'text-indigo-600 bg-indigo-50' : 'text-muted-token hover:bg-[var(--surface-muted)]')}
                      title={app.alert ? 'Alerting you when this app is used' : 'Alert me when this app is used'}
                    >
                      {app.alert ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                    </button>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    {[
                      { key: 'allow', label: 'Allow', icon: CheckCircle2 },
                      { key: 'time_limit', label: app.status === 'time_limit' ? 'Edit limit' : 'Time limit', icon: Clock },
                      { key: 'block', label: 'Block', icon: Ban },
                    ].map((opt) => {
                      const active = app.status === opt.key
                      return (
                        <button
                          key={opt.key}
                          disabled={busy}
                          onClick={() => setStatus(app, opt.key)}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50',
                            active
                              ? opt.key === 'block' ? 'border-red-500 bg-red-50 text-red-700' : opt.key === 'time_limit' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-[var(--border-color)] text-secondary-token hover:bg-[var(--surface-muted)]',
                          )}
                        >
                          <opt.icon className="w-3.5 h-3.5" /> {opt.label}
                        </button>
                      )
                    })}
                  </div>

                  {app.limitMin !== null && (
                    <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                      <div
                        className={cn('h-1.5 rounded-full transition-all', overLimit ? 'bg-red-500' : 'bg-amber-500')}
                        style={{ width: `${app.limitMin > 0 ? Math.min(100, (usedMin / app.limitMin) * 100) : 100}%` }}
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-token">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        Rules apply to all of this child's devices. Blocked and over-limit apps are sent back to the home screen the moment they open (needs Accessibility enabled on the device). Time limits need "Usage access".
      </p>

      {limitModal && (
        <TimeLimitModal
          app={limitModal.app}
          rule={limitModal.rule}
          onClose={() => setLimitModal(null)}
          onSave={(patch) => applyRule(limitModal.app, { action: 'time_limit', ...patch })}
        />
      )}
    </div>
  )
}
