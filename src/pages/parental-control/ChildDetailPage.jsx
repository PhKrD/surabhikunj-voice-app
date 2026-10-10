import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Smartphone, MapPin, Hourglass, Clock, Globe, ShieldAlert,
  LayoutDashboard, Moon, Gamepad2, ShieldCheck, ShieldOff, ShieldQuestion, Lock, WifiOff, Gift, Activity,
  BatteryMedium, RefreshCw, ChevronDown, Check,
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { getChild, listDevices, listChildren, getAttentionCounts } from '@/lib/parentalControlApi'
import { protectionHealth, PROTECTION_STATUS_META, onlineStatus } from '@/lib/protectionHealth'
import { friendlyError } from '@/lib/friendlyError'
import CommandCenter from './CommandCenter'
import SummaryTab from './tabs/SummaryTab'
import DevicesTab from './tabs/DevicesTab'
import UsageTab from './tabs/UsageTab'
import RestrictedTimesTab from './tabs/RestrictedTimesTab'
import RulesTab from './tabs/RulesTab'
import SchedulesTab from './tabs/SchedulesTab'
import WebsiteRulesTab from './tabs/WebsiteRulesTab'
import WebActivityTab from './tabs/WebActivityTab'
import LocationTab from './tabs/LocationTab'
import AlertsTab from './tabs/AlertsTab'
import RequestsTab from './tabs/RequestsTab'
import AuditLogTab from './tabs/AuditLogTab'
import BonusTab from './tabs/BonusTab'

// Eight sections instead of thirteen tabs on one screen. A section with
// more than one view shows a small secondary switch.
const SECTIONS = [
  { key: 'today', label: 'Today', icon: LayoutDashboard, tabs: [{ key: 'summary', label: 'Overview', Component: SummaryTab }] },
  { key: 'time', label: 'Screen time', icon: Hourglass, tabs: [
    { key: 'usage', label: 'Daily limits', Component: UsageTab },
    { key: 'restricted', label: 'Restricted hours', Component: RestrictedTimesTab },
    { key: 'bonus', label: 'Extra time', Component: BonusTab },
  ] },
  { key: 'apps', label: 'Apps', icon: Gamepad2, tabs: [{ key: 'rules', label: 'Apps', Component: RulesTab }] },
  { key: 'routines', label: 'Routines', icon: Clock, tabs: [{ key: 'schedules', label: 'Routines', Component: SchedulesTab }] },
  { key: 'web', label: 'Web', icon: Globe, tabs: [
    { key: 'websites', label: 'Filtering', Component: WebsiteRulesTab },
    { key: 'webActivity', label: 'History', Component: WebActivityTab },
  ] },
  { key: 'places', label: 'Location', icon: MapPin, tabs: [{ key: 'location', label: 'Places', Component: LocationTab }] },
  { key: 'activity', label: 'Activity', icon: Activity, tabs: [
    { key: 'alerts', label: 'Alerts', Component: AlertsTab },
    { key: 'requests', label: 'Requests', Component: RequestsTab },
    { key: 'audit', label: 'History', Component: AuditLogTab },
  ] },
  { key: 'devices', label: 'Protection', icon: ShieldCheck, tabs: [{ key: 'devices', label: 'Devices & protection', Component: DevicesTab }] },
]
const sectionOf = (tabKey) => SECTIONS.find((s) => s.tabs.some((t) => t.key === tabKey)) ?? SECTIONS[0]

const PROTECTION_ICON = { strong: ShieldCheck, attention: ShieldAlert, critical: ShieldOff, unknown: ShieldQuestion, inactive: ShieldQuestion }
const LOCK_LABEL = { daily_limit: 'Daily limit reached', restricted_time: 'Restricted hours', schedule: 'Routine on' }

/** The device that best represents the child right now: most recently seen active one. */
function primaryDevice(devices) {
  return devices
    .filter((d) => d.is_active)
    .sort((a, b) => new Date(b.last_seen_at ?? 0) - new Date(a.last_seen_at ?? 0))[0] ?? null
}

/**
 * State chips. The parent's own lock / pause come from the child row
 * (desired state, migration 72); automatic locks come from the device report.
 */
function stateChips(device, child) {
  const chips = []
  const s = device?.enforcement_state
  if (child?.parent_lock_active) chips.push({ key: 'lock', label: 'Locked by you', tone: 'danger', icon: Lock })
  else if (s?.lock_reason && s.lock_reason !== 'parent_lock') {
    chips.push({ key: 'auto', label: s.active_schedule && s.lock_reason === 'schedule' ? s.active_schedule : LOCK_LABEL[s.lock_reason] ?? 'Restricted', tone: 'warning', icon: Moon })
  }
  if (child?.internet_pause_active) chips.push({ key: 'net', label: 'Internet paused', tone: 'warning', icon: WifiOff })
  if (child?.bonus_expires_at && new Date(child.bonus_expires_at) > new Date()) {
    chips.push({ key: 'bonus', label: `Extra time until ${new Date(child.bonus_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, tone: 'success', icon: Gift })
  }
  return chips
}

const TONE = {
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-accent-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  default: 'bg-[var(--surface-muted)] text-secondary-token',
  tulasi: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  saffron: 'bg-[var(--color-accent-soft)] text-[var(--color-warning)]',
}

function syncLabel(device) {
  const t = device?.last_enforcement_at ? new Date(device.last_enforcement_at).getTime() : NaN
  if (!Number.isFinite(t)) return 'Never synced'
  const min = Math.round((Date.now() - t) / 60_000)
  return min < 2 ? 'Synced just now' : min < 60 ? `Synced ${min} min ago` : `Synced ${Math.round(min / 60)} h ago`
}

function ChildSwitcher({ current, children, onPick }) {
  const [open, setOpen] = useState(false)
  if (children.length < 2) return null
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-[var(--surface-muted)] text-sm font-semibold text-secondary-token"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        Switch child <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 mt-2 w-60 z-30 rounded-2xl border border-[var(--border-color)] bg-[var(--surface)] shadow-[var(--shadow-3)] p-1.5">
          {children.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === current}
                onClick={() => { setOpen(false); onPick(c.id) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-muted)] text-left"
              >
                <Avatar name={c.display_name} size="sm" />
                <span className="flex-1 truncate text-sm font-medium text-primary-token">{c.display_name}</span>
                {c.id === current && <Check className="w-4 h-4 text-[var(--color-primary-600)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ChildDetailPage() {
  const { childId } = useParams()
  const navigate = useNavigate()
  // Select the stable action, not the whole store: the store object changes
  // with every toast, which used to re-run the load effect and reset the page.
  const toastError = useToastStore((s) => s.error)

  const [child, setChild] = useState(null)
  const [devices, setDevices] = useState([])
  const [siblings, setSiblings] = useState([])
  const [counts, setCounts] = useState({ unreadAlerts: 0, pendingRequests: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const navRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [childData, deviceList] = await Promise.all([getChild(childId), listDevices(childId)])
      setChild(childData)
      setDevices(deviceList)
      getAttentionCounts(childId).then(setCounts).catch(() => {})
      listChildren().then(setSiblings).catch(() => {})
    } catch (error) {
      toastError('Could not load this child', friendlyError(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toastError])

  useEffect(() => {
    const id = setTimeout(() => { setLoading(true); load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  // A different child starts on their overview.
  useEffect(() => {
    const id = setTimeout(() => setActiveTab('summary'), 0)
    return () => clearTimeout(id)
  }, [childId])

  // Keep the selected section visible in the horizontally scrolling bar.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeTab])

  const device = useMemo(() => primaryDevice(devices), [devices])
  const health = useMemo(() => protectionHealth(device, child, { vpnRequired: device?.enforcement_state?.vpn_filtering_wanted === true }), [device, child])
  const chips = useMemo(() => stateChips(device, child), [device, child])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4" aria-busy="true">
        <div className="h-36 rounded-3xl bg-[var(--surface-muted)] animate-pulse" />
        <div className="h-12 rounded-2xl bg-[var(--surface-muted)] animate-pulse" />
        <div className="h-64 rounded-3xl bg-[var(--surface-muted)] animate-pulse" />
      </div>
    )
  }
  if (!child) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-6">
        <p className="font-semibold text-primary-token">This child isn&apos;t available</p>
        <p className="text-sm text-muted-token mt-1">They may have been removed from your family.</p>
        <button type="button" onClick={() => navigate('/parental-control')} className="mt-4 text-sm font-semibold text-[var(--color-primary-600)]">Back to Family</button>
      </div>
    )
  }

  const section = sectionOf(activeTab)
  const ActiveComponent = section.tabs.find((t) => t.key === activeTab)?.Component ?? section.tabs[0].Component
  const seen = device ? onlineStatus(device) : null
  const meta = PROTECTION_STATUS_META[health.status]
  const ProtIcon = PROTECTION_ICON[health.status]
  const battery = device?.enforcement_state?.battery_pct
  const badge = { activity: counts.unreadAlerts + counts.pendingRequests, devices: ['critical', 'attention'].includes(health.status) ? 1 : 0 }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
      {/* Child header */}
      <section className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-4 sm:p-5 shadow-[var(--shadow-1)]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button type="button" onClick={() => navigate('/parental-control')} className="inline-flex items-center gap-1.5 h-10 -ml-1 px-1 text-sm font-medium text-secondary-token hover:text-primary-token">
            <ArrowLeft className="w-4 h-4" /> Family
          </button>
          <div className="flex items-center gap-2">
            <ChildSwitcher current={childId} children={siblings} onPick={(id) => navigate(`/parental-control/${id}`)} />
            <button
              type="button"
              onClick={() => { setRefreshing(true); load() }}
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--surface-muted)] text-secondary-token"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Avatar name={child.display_name} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-primary-token truncate">{child.display_name}</h1>
            {device ? (
              <p className="text-sm text-secondary-token mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', seen.tone === 'tulasi' ? 'bg-[var(--color-success)]' : seen.tone === 'saffron' ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-danger)]')} />
                  {seen.label}
                </span>
                {battery != null && <span className="inline-flex items-center gap-1"><BatteryMedium className="w-4 h-4" />{battery}%</span>}
                <span className="text-muted-token">{syncLabel(device)}</span>
              </p>
            ) : (
              <p className="text-sm text-secondary-token mt-0.5">No phone paired yet</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {device ? (
            <button
              type="button"
              onClick={() => setActiveTab('devices')}
              className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold', TONE[meta.tone] ?? TONE.default)}
            >
              <ProtIcon className="w-4 h-4" /> Protection: {meta.label}{health.score != null ? ` · ${health.score}%` : ''}
            </button>
          ) : (
            <button type="button" onClick={() => setActiveTab('devices')} className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold', TONE.saffron)}>
              <Smartphone className="w-4 h-4" /> Pair a phone
            </button>
          )}
          {chips.map((c) => (
            <span key={c.key} className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold', TONE[c.tone])}>
              <c.icon className="w-4 h-4" /> {c.label}
            </span>
          ))}
        </div>
      </section>

      {/* Section navigation: horizontal, sticky, thumb-sized */}
      <nav className="sticky top-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 bg-[var(--surface-app)]" aria-label="Sections">
        <div ref={navRef} className="flex gap-2 overflow-x-auto no-scrollbar">
          {SECTIONS.map((s) => {
            const active = section.key === s.key
            const n = badge[s.key] ?? 0
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveTab(s.tabs[0].key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative shrink-0 inline-flex items-center gap-2 h-11 px-4 rounded-2xl text-sm font-semibold transition-colors',
                  active ? 'bg-[var(--color-primary-600)] text-white shadow-[var(--shadow-1)]' : 'bg-[var(--surface)] border border-[var(--border-color)] text-secondary-token',
                )}
              >
                <s.icon className="w-4 h-4" /> {s.label}
                {n > 0 && (
                  <span className={cn('min-w-5 h-5 px-1.5 rounded-full text-[11px] leading-5 text-center', active ? 'bg-[var(--surface)] text-[var(--color-primary-700)]' : 'bg-[var(--color-danger)] text-white')}>
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {section.tabs.length > 1 && (
          <div className="flex gap-1 mt-2 p-1 rounded-xl bg-[var(--surface-muted)] w-fit max-w-full overflow-x-auto no-scrollbar">
            {section.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn('shrink-0 h-9 px-3 rounded-lg text-sm font-medium', activeTab === t.key ? 'bg-[var(--surface)] text-primary-token shadow-[var(--shadow-1)]' : 'text-secondary-token')}
              >
                {t.label}
                {t.key === 'requests' && counts.pendingRequests > 0 && ` (${counts.pendingRequests})`}
                {t.key === 'alerts' && counts.unreadAlerts > 0 && ` (${counts.unreadAlerts})`}
              </button>
            ))}
          </div>
        )}
      </nav>

      {section.key === 'today' && (
        <CommandCenter devices={devices} childId={childId} child={child} onChildUpdated={setChild} onRefreshDevices={load} />
      )}

      {ActiveComponent && (
        <ActiveComponent
          key={activeTab}
          childId={childId}
          child={child}
          onNavigateTab={setActiveTab}
          onChildUpdated={(c) => { setChild(c); getAttentionCounts(childId).then(setCounts).catch(() => {}) }}
        />
      )}
    </div>
  )
}
