import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone, Clock, AlertTriangle, ShieldCheck, ArrowRight, Activity } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { listChildren, getTodayUsage, listAlerts, listDevices } from '@/lib/parentalControlApi'

function formatDuration(ms) {
  const totalSec = Math.round((ms || 0) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false
  const diff = Date.now() - new Date(lastSeenAt).getTime()
  return diff < 2 * 60 * 1000 // 2 minutes
}

export default function ParentalControlDashboardPage() {
  const navigate = useNavigate()
  const toast = useToastStore()
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [childData, setChildData] = useState({})

  const load = useCallback(async () => {
    try {
      const childrenList = await listChildren()
      setChildren(childrenList)

      const data = {}
      for (const child of childrenList) {
        const [usage, alerts, devices] = await Promise.all([
          getTodayUsage(child.id).catch(() => []),
          listAlerts(child.id, { limit: 5 }).catch(() => []),
          listDevices(child.id).catch(() => []),
        ])
        data[child.id] = {
          usage,
          alerts,
          devices,
          totalMs: usage.reduce((sum, u) => sum + (u.total_foreground_ms || 0), 0),
          unreadAlerts: alerts.filter((a) => !a.is_read).length,
          onlineDevices: devices.filter((d) => d.is_active && isOnline(d.last_seen_at)).length,
        }
      }
      setChildData(data)
    } catch (error) {
      toast.error('Could not load dashboard', error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  const totalChildren = children.length
  const totalAlerts = Object.values(childData).reduce((sum, d) => sum + d.unreadAlerts, 0)
  const totalOnline = Object.values(childData).reduce((sum, d) => sum + d.onlineDevices, 0)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Parental Control Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Overview of all children and their devices</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardBody className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <Activity className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalChildren}</p>
                <p className="text-xs text-slate-500">Children</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalOnline}</p>
                <p className="text-xs text-slate-500">Online devices</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalAlerts}</p>
                <p className="text-xs text-slate-500">Unread alerts</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-saffron-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-saffron-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {formatDuration(Object.values(childData).reduce((sum, d) => sum + d.totalMs, 0))}
                </p>
                <p className="text-xs text-slate-500">Total screen time</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Child cards */}
      <div className="space-y-4">
        {children.length === 0 ? (
          <div className="text-center py-10 px-6">
            <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No children yet</p>
            <p className="text-xs text-slate-400 mt-1">Add a child to start monitoring their devices.</p>
          </div>
        ) : (
          children.map((child) => {
            const data = childData[child.id] || { usage: [], alerts: [], devices: [], totalMs: 0, unreadAlerts: 0, onlineDevices: 0 }
            return (
              <Card key={child.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/parental-control/${child.id}`)}>
                <CardBody className="py-4">
                  <div className="flex items-start gap-4">
                    <Avatar name={child.display_name} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-800">{child.display_name}</h3>
                        {data.onlineDevices > 0 && <Badge variant="tulasi" className="text-xs">Online</Badge>}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <Smartphone className="w-3.5 h-3.5" />
                          {data.devices.length} device{data.devices.length !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDuration(data.totalMs)} today
                        </span>
                        {data.unreadAlerts > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {data.unreadAlerts} alert{data.unreadAlerts !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {data.alerts.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <p className="text-xs text-slate-400 mb-1.5">Recent alerts</p>
                          <div className="space-y-1">
                            {data.alerts.slice(0, 2).map((alert) => (
                              <p key={alert.id} className="text-xs text-slate-600 truncate">
                                {alert.title}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400" />
                  </div>
                </CardBody>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
