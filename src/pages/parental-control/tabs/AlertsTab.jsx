import { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert, MapPin, Clock, Ban, WifiOff, Gift, BatteryLow, Smartphone, Bell,
} from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { listAlerts, markAlertRead, subscribeToAlerts } from '@/lib/parentalControlApi'

const ALERT_ICONS = {
  sos: ShieldAlert,
  geofence_enter: MapPin,
  geofence_exit: MapPin,
  screen_time_exceeded: Clock,
  app_time_limit_exceeded: Clock,
  blocked_app_attempt: Ban,
  device_offline: WifiOff,
  bonus_time_requested: Gift,
  low_battery: BatteryLow,
  device_enrolled: Smartphone,
}

const SEVERITY_VARIANT = { info: 'blue', warning: 'yellow', critical: 'red' }

export default function AlertsTab({ childId }) {
  const toast = useToastStore()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAlerts(await listAlerts(childId))
    } catch (error) {
      toast.error('Could not load alerts', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    return subscribeToAlerts(childId, (alert) => {
      setAlerts((prev) => [alert, ...prev])
    })
  }, [childId])

  const handleMarkRead = async (alert) => {
    if (alert.is_read) return
    setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, is_read: true } : a)))
    try {
      await markAlertRead(alert.id)
    } catch {
      // best-effort — revert on failure
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, is_read: false } : a)))
    }
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  if (alerts.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <Bell className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No alerts yet.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const Icon = ALERT_ICONS[alert.alert_type] ?? Bell
        return (
          <Card
            key={alert.id}
            hover
            onClick={() => handleMarkRead(alert)}
            className={alert.is_read ? 'opacity-60' : ''}
          >
            <CardBody className="py-3.5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4.5 h-4.5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-800 truncate">{alert.title}</p>
                  {!alert.is_read && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />}
                </div>
                {alert.body && <p className="text-sm text-slate-500 mt-0.5">{alert.body}</p>}
                <p className="text-xs text-slate-400 mt-1">{new Date(alert.occurred_at).toLocaleString()}</p>
              </div>
              <Badge variant={SEVERITY_VARIANT[alert.severity] ?? 'default'}>{alert.severity}</Badge>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
