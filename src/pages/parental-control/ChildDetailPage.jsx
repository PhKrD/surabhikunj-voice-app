import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Smartphone, Sliders, MapPin, Bell, Gift, Lock, LockOpen, WifiOff, Wifi } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { getChild, listDevices, sendDeviceCommand } from '@/lib/parentalControlApi'
import DevicesTab from './tabs/DevicesTab'
import RulesTab from './tabs/RulesTab'
import LocationTab from './tabs/LocationTab'
import AlertsTab from './tabs/AlertsTab'
import BonusTab from './tabs/BonusTab'

const TABS = [
  { key: 'devices', label: 'Devices', icon: Smartphone, Component: DevicesTab },
  { key: 'rules', label: 'App Rules', icon: Sliders, Component: RulesTab },
  { key: 'location', label: 'Location', icon: MapPin, Component: LocationTab },
  { key: 'alerts', label: 'Alerts', icon: Bell, Component: AlertsTab },
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
  const [sendingCommand, setSendingCommand] = useState(false)

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

  const broadcastCommand = async (commandType, label) => {
    if (activeDevices.length === 0) {
      toast.error('No active devices to send a command to')
      return
    }
    setSendingCommand(true)
    try {
      await Promise.all(activeDevices.map((d) => sendDeviceCommand({ deviceId: d.id, commandType })))
      toast.success(label)
    } catch (error) {
      toast.error('Could not send command', error.message)
    } finally {
      setSendingCommand(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>
  if (!child) return <div className="text-center py-12 text-slate-400 text-sm">Child not found.</div>

  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.Component

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <button
        onClick={() => navigate('/parental-control')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-4 h-4" /> All children
      </button>

      <div className="flex items-center gap-3">
        <Avatar name={child.display_name} size="lg" />
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-800">{child.display_name}</h2>
          <p className="text-sm text-slate-400">
            {activeDevices.length} active device{activeDevices.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={sendingCommand}
          onClick={() => broadcastCommand('pause_internet', 'Internet paused on all devices')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
        >
          <WifiOff className="w-4 h-4" /> Pause internet
        </button>
        <button
          disabled={sendingCommand}
          onClick={() => broadcastCommand('resume_internet', 'Internet resumed on all devices')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:border-tulasi-200 hover:text-tulasi-600 disabled:opacity-50"
        >
          <Wifi className="w-4 h-4" /> Resume internet
        </button>
        <button
          disabled={sendingCommand}
          onClick={() => broadcastCommand('lock_device', 'Lock command sent to all devices')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50"
        >
          <Lock className="w-4 h-4" /> Lock now
        </button>
        <button
          disabled={sendingCommand}
          onClick={() => broadcastCommand('unlock_device', 'Unlock command sent to all devices')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:border-emerald-200 hover:text-emerald-600 disabled:opacity-50"
        >
          <LockOpen className="w-4 h-4" /> Unlock now
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-100 overflow-x-auto scrollbar-hide">
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
                  : 'border-transparent text-slate-500 hover:text-slate-700'
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
