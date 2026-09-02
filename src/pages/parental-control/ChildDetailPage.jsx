import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Smartphone, Sliders, MapPin, Bell, Gift, BarChart3, Clock, Globe, Send, ShieldAlert } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { getChild, listDevices } from '@/lib/parentalControlApi'
import CommandCenter from './CommandCenter'
import DevicesTab from './tabs/DevicesTab'
import UsageTab from './tabs/UsageTab'
import RulesTab from './tabs/RulesTab'
import SchedulesTab from './tabs/SchedulesTab'
import WebsiteRulesTab from './tabs/WebsiteRulesTab'
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
      </div>

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
