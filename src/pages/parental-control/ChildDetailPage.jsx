import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Smartphone, Sliders, MapPin, Bell, Gift, BarChart3, Clock, Globe, Send, ShieldAlert, History, Link2 } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { getChild, listDevices, updateChild } from '@/lib/parentalControlApi'
import MemberLinkPicker from '@/components/parental-control/MemberLinkPicker'
import CommandCenter from './CommandCenter'
import DevicesTab from './tabs/DevicesTab'
import UsageTab from './tabs/UsageTab'
import RulesTab from './tabs/RulesTab'
import SchedulesTab from './tabs/SchedulesTab'
import WebsiteRulesTab from './tabs/WebsiteRulesTab'
import WebActivityTab from './tabs/WebActivityTab'
import LocationTab from './tabs/LocationTab'
import AlertsTab from './tabs/AlertsTab'
import RequestsTab from './tabs/RequestsTab'
import AuditLogTab from './tabs/AuditLogTab'
import BonusTab from './tabs/BonusTab'

const TABS = [
  { key: 'devices', label: 'Devices', icon: Smartphone, Component: DevicesTab },
  { key: 'usage', label: 'Screen Time', icon: BarChart3, Component: UsageTab },
  { key: 'schedules', label: 'Schedules', icon: Clock, Component: SchedulesTab },
  { key: 'rules', label: 'App Rules', icon: Sliders, Component: RulesTab },
  { key: 'websites', label: 'Websites', icon: Globe, Component: WebsiteRulesTab },
  { key: 'webActivity', label: 'Web Activity', icon: History, Component: WebActivityTab },
  { key: 'location', label: 'Location', icon: MapPin, Component: LocationTab },
  { key: 'alerts', label: 'Alerts', icon: Bell, Component: AlertsTab },
  { key: 'requests', label: 'Requests', icon: Send, Component: RequestsTab },
  { key: 'audit', label: 'Audit Log', icon: ShieldAlert, Component: AuditLogTab },
  { key: 'bonus', label: 'Bonus Time', icon: Gift, Component: BonusTab },
]

export default function ChildDetailPage() {
  const { childId } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore()

  const [child, setChild] = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('devices')
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [savingLink, setSavingLink] = useState(false)

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

  const activeDevices = devices.filter((d) => d.is_active)

  const handleLinkChange = async (profileId) => {
    setSavingLink(true)
    try {
      const updated = await updateChild(childId, { linked_profile_id: profileId })
      setChild(updated)
      setShowLinkPicker(false)
      toast.success(profileId ? 'Linked to VOICE member' : 'Unlinked — device-only again')
    } catch (error) {
      toast.error('Could not update link', error.message)
    } finally {
      setSavingLink(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading...</div>
  if (!child) return <div className="text-center py-12 text-muted-token text-sm">Child not found.</div>

  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.Component

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <button
        onClick={() => navigate('/parental-control')}
        className="flex items-center gap-1.5 text-sm text-secondary-token hover:text-primary-token"
      >
        <ArrowLeft className="w-4 h-4" /> All children
      </button>

      <div className="flex items-center gap-3">
        <Avatar name={child.display_name} size="lg" />
        <div className="flex-1">
          <h2 className="text-lg font-bold text-primary-token">{child.display_name}</h2>
          <p className="text-sm text-muted-token">
            {activeDevices.length} active device{activeDevices.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={() => setShowLinkPicker((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-colors',
            child.linked_profile_id
              ? 'border-tulasi-200 bg-tulasi-50 text-tulasi-700'
              : 'border-[var(--border-color)] text-secondary-token hover:bg-[var(--surface-muted)]'
          )}
        >
          <Link2 className="w-3.5 h-3.5" />
          {child.linked_profile_id ? 'Linked to member' : 'Link to member'}
        </button>
      </div>

      {showLinkPicker && (
        <div className="rounded-2xl border border-[var(--border-color)] p-4">
          <MemberLinkPicker value={child.linked_profile_id} onChange={handleLinkChange} />
          {savingLink && <p className="text-xs text-muted-token mt-2">Saving...</p>}
          <p className="text-xs text-muted-token mt-2">
            Changing this only affects the NEXT time a device is paired (or re-paired) for this child —
            it does not retroactively change already-paired devices' sessions.
          </p>
        </div>
      )}

      {/* Command center — per-device targeting + true command lifecycle */}
      <CommandCenter devices={devices} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-color)] overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-secondary-token hover:text-primary-token'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          )
        })}
      </div>

      {ActiveComponent && <ActiveComponent childId={childId} />}
    </div>
  )
}
