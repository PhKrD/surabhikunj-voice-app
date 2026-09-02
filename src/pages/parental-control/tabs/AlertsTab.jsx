import { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert, MapPin, Clock, Ban, WifiOff, Gift, BatteryLow, Smartphone, Bell, CheckCircle, RefreshCw,
} from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
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

const ALERT_SUGGESTIONS = {
  screen_time_exceeded: 'Consider reducing the daily limit or granting bonus time.',
  app_time_limit_exceeded: 'Consider increasing the per-app time limit or blocking the app.',
  blocked_app_attempt: 'The device may not be Device Owner. Re-enroll to enforce rules.',
  device_offline: 'Check if the device is connected to the internet.',
}

export default function AlertsTab({ childId }) {
  const toast = useToastStore()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAlerts(await listAlerts(childId))
    } catch (error) {
      toast.error('Could not load alerts', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
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
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, is_read: false } : a)))
    }
  }

  const markAllRead = async () => {
    const unread = alerts.filter((a) => !a.is_read)
    if (unread.length === 0) return
    try {
      await Promise.all(unread.map((a) => markAlertRead(a.id)))
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })))
      toast.success('All alerts marked as read')
    } catch (error) {
      toast.error('Could not mark all read', error.message)
    }
  }

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  const unreadCount = alerts.filter((a) => !a.is_read).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary-token">Alerts</h3>
          {unreadCount > 0 && <Badge variant="red">{unreadCount} unread</Badge>}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button size="sm" variant="secondary" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
          <button
            onClick={refresh}
            className="p-2 rounded-xl text-muted-token hover:text-saffron-500 hover:bg-saffron-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center">
            <CheckCircle className="w-10 h-10 text-muted-token mx-auto mb-3" />
            <p className="text-sm text-secondary-token">No alerts</p>
            <p className="text-xs text-muted-token mt-1">Everything is running smoothly.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const Icon = ALERT_ICONS[alert.alert_type] ?? Bell
            const suggestion = ALERT_SUGGESTIONS[alert.alert_type]
            return (
              <Card
                key={alert.id}
                hover
                onClick={() => handleMarkRead(alert)}
                className={alert.is_read ? 'opacity-60' : ''}
              >
                <CardBody className="py-3.5 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--surface-muted)] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4.5 h-4.5 text-secondary-token" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-primary-token truncate">{alert.title}</p>
                      {!alert.is_read && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />}
                    </div>
                    {alert.body && <p className="text-sm text-secondary-token mt-0.5">{alert.body}</p>}
                    {suggestion && !alert.is_read && (
                      <p className="text-xs text-indigo-600 mt-1.5 bg-indigo-50 px-2 py-1 rounded-md inline-block">
                        💡 {suggestion}
                      </p>
                    )}
                    <p className="text-xs text-muted-token mt-1">{new Date(alert.occurred_at).toLocaleString()}</p>
                  </div>
                  <Badge variant={SEVERITY_VARIANT[alert.severity] ?? 'default'}>{alert.severity}</Badge>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
