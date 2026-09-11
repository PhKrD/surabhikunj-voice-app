import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Smartphone, MapPin, Bell, Gift, Hourglass, Clock, Globe, Send, ShieldAlert, History,
  LayoutDashboard, Moon, Gamepad2, ShieldCheck, Lock, WifiOff,
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { getChild, listDevices } from '@/lib/parentalControlApi'
import { isDeviceOnline } from '@/lib/commandStatus'
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

// Three groups, wrapped pills — the old single scrolling strip of 13 tabs
// hid half of them off the right edge on a phone.
const TAB_GROUPS = [
  { label: 'Rules', tabs: [
    { key: 'summary', label: 'Summary', icon: LayoutDashboard, Component: SummaryTab },
    { key: 'usage', label: 'Daily limits', icon: Hourglass, Component: UsageTab },
    { key: 'restricted', label: 'Restricted times', icon: Moon, Component: RestrictedTimesTab },
    { key: 'schedules', label: 'Routines', icon: Clock, Component: SchedulesTab },
    { key: 'rules', label: 'Games & Apps', icon: Gamepad2, Component: RulesTab },
    { key: 'websites', label: 'Web filtering', icon: Globe, Component: WebsiteRulesTab },
  ] },
  { label: 'Activity', tabs: [
    { key: 'alerts', label: 'Alerts', icon: Bell, Component: AlertsTab },
    { key: 'requests', label: 'Requests', icon: Send, Component: RequestsTab },
    { key: 'webActivity', label: 'Web activity', icon: History, Component: WebActivityTab },
    { key: 'location', label: 'Places', icon: MapPin, Component: LocationTab },
    { key: 'bonus', label: 'Extra time', icon: Gift, Component: BonusTab },
  ] },
  { label: 'Setup', tabs: [
    { key: 'devices', label: 'Devices & protection', icon: Smartphone, Component: DevicesTab },
    { key: 'audit', label: 'Audit log', icon: ShieldAlert, Component: AuditLogTab },
  ] },
]
const TABS = TAB_GROUPS.flatMap((g) => g.tabs)

/** Live status chips straight from what the devices last reported. */
function statusChips(devices, child) {
  const active = devices.filter((d) => d.is_active)
  if (active.length === 0) return [{ key: 'nodev', label: 'No device paired', variant: 'saffron', icon: Smartphone }]

  const chips = []
  const missing = new Set()
  for (const d of active) {
    const s = d.enforcement_state
    if (!s) { if (d.device_owner_mode !== 'device_owner') missing.add('setup'); continue }
    if (s.device_admin === false) missing.add('Device admin')
    if (s.accessibility_enabled === false) missing.add('Accessibility')
    if (s.usage_access === false) missing.add('Usage access')
    if (s.lock_reason === 'parent_lock') chips.push({ key: 'lock', label: 'Locked by you', variant: 'red', icon: Lock })
    else if (s.lock_reason) chips.push({ key: 'lock', label: LOCK_LABEL[s.lock_reason] ?? 'Locked', variant: 'yellow', icon: Hourglass })
    if (s.internet_paused || s.manual_internet_pause) chips.push({ key: 'net', label: 'Internet paused', variant: 'yellow', icon: WifiOff })
  }

  if (missing.size === 0) chips.unshift({ key: 'prot', label: 'Protected', variant: 'tulasi', icon: ShieldCheck })
  else if (missing.has('setup') && missing.size === 1) chips.unshift({ key: 'prot', label: 'Setup needed', variant: 'saffron', icon: ShieldAlert })
  else chips.unshift({ key: 'prot', label: `Missing ${[...missing].filter((m) => m !== 'setup').join(', ')}`, variant: 'yellow', icon: ShieldAlert })

  if (!child?.parent_pin_hash) {
    chips.push({ key: 'pin', label: 'No protection PIN', variant: 'saffron', icon: ShieldAlert })
  }
  return [...new Map(chips.map((c) => [c.key, c])).values()]
}

const LOCK_LABEL = { daily_limit: "Time's up", restricted_time: 'Restricted time', schedule: 'On a break' }

export default function ChildDetailPage() {
  const { childId } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore()

  const [child, setChild] = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('summary')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [childData, deviceList] = await Promise.all([getChild(childId), listDevices(childId)])
      setChild(childData)
      setDevices(deviceList)
    } catch (error) {
      toast.error('Could not load child', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const chips = useMemo(() => statusChips(devices, child), [devices, child])

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading…</div>
  if (!child) return <div className="text-center py-12 text-muted-token text-sm">Child not found.</div>

  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.Component
  const activeDevices = devices.filter((d) => d.is_active)
  const onlineCount = activeDevices.filter((d) => isDeviceOnline(d)).length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white px-6 pt-14 pb-8 rounded-b-[2rem]">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate('/parental-control')}
            className="flex items-center gap-1.5 text-sm text-indigo-200 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Family
          </button>

          <div className="flex items-center gap-4">
            <Avatar name={child.display_name} size="lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold truncate">{child.display_name}</h2>
              <p className="text-sm text-indigo-200 mt-1">
                {activeDevices.length === 0
                  ? 'No device paired yet'
                  : `${onlineCount > 0 ? 'Online' : 'Offline'} · ${activeDevices.length} device${activeDevices.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-5">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setActiveTab('devices')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/12 border border-white/15 text-sm font-semibold hover:bg-white/20 transition-colors"
              >
                <c.icon className="w-3.5 h-3.5" /> {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        {/* Quick actions */}
        <CommandCenter devices={devices} childId={childId} onRefreshDevices={load} />

        {/* Tabs */}
        <nav className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-4 space-y-3">
          {TAB_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-token px-1 pb-2">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.tabs.map((tab) => {
                  const Icon = tab.icon
                  const active = activeTab === tab.key
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors',
                        active
                          ? 'bg-indigo-600 text-white'
                          : 'bg-[var(--surface-muted)] text-secondary-token hover:text-primary-token',
                      )}
                    >
                      <Icon className="w-4 h-4" /> {tab.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {ActiveComponent && (
          <ActiveComponent childId={childId} onNavigateTab={setActiveTab} onChildUpdated={setChild} />
        )}
      </div>
    </div>
  )
}
