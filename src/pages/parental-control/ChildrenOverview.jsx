import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Smartphone, AlertTriangle, ShieldCheck, ShieldAlert, ChevronRight, Plus, Hourglass, WifiOff, Lock,
} from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listChildren, getTodayUsage, listAlerts, listDevices, getScreenTimeRule } from '@/lib/parentalControlApi'
import { isDeviceOnline } from '@/lib/commandStatus'
import { limitForDay } from '@/lib/screenTimePolicy'

function formatDuration(ms) {
  const totalMin = Math.round((ms || 0) / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Real, honest protection status derived from what the device itself last
 * reported (enforcement_state — Device Admin + Accessibility + Usage access
 * is the full, no-reset setup; Device Owner is an optional extra). Falls
 * back to device_owner_mode for devices that have never reported. Never a
 * fabricated "Protected" flag. See PLATFORM_LIMITATIONS.md.
 */
function protectionMeta(devices) {
  const active = devices.filter((d) => d.is_active)
  if (active.length === 0) return null
  const missing = new Set()
  for (const d of active) {
    const s = d.enforcement_state
    if (!s) {
      if (d.device_owner_mode !== 'device_owner') missing.add('setup')
      continue
    }
    if (s.device_admin === false) missing.add('Device admin')
    if (s.accessibility_enabled === false) missing.add('Accessibility')
    if (s.usage_access === false) missing.add('Usage access')
  }
  if (missing.size === 0) return { label: 'Protected', variant: 'tulasi', icon: ShieldCheck }
  if (missing.has('setup') && missing.size === 1) return { label: 'Setup needed', variant: 'saffron', icon: ShieldAlert }
  return { label: `Missing ${[...missing].filter((m) => m !== 'setup').join(', ')}`, variant: 'yellow', icon: ShieldAlert }
}

/**
 * What is actively restricting this child right now.
 *
 * The parent's own lock and internet pause are read from the child row —
 * they are desired state (migration 72) and hold whether or not a device
 * is currently online, so a locked device that happens to be offline must
 * still show as locked. Automatic locks (bedtime, time's up) come from the
 * reports of devices we can actually hear from.
 */
function liveState(devices, child) {
  const online = devices.filter((d) => d.is_active && isDeviceOnline(d))
  const chips = []
  for (const d of online) {
    const s = d.enforcement_state
    if (!s) continue
    if (s.lock_reason && s.lock_reason !== 'parent_lock') {
      chips.push({ key: 'lock', label: labelForLock(s.lock_reason), icon: Hourglass, variant: 'yellow' })
    }
  }

  const reported = devices.find((d) => d.is_active && d.enforcement_state)?.enforcement_state
  const locked = child?.parent_lock_active ?? reported?.lock_reason === 'parent_lock'
  const paused = child?.internet_pause_active ?? Boolean(reported?.manual_internet_pause)
  if (locked) chips.push({ key: 'parentlock', label: 'Locked', icon: Lock, variant: 'red' })
  if (paused) chips.push({ key: 'net', label: 'Internet paused', icon: WifiOff, variant: 'yellow' })

  // Dedupe by key — two devices in the same state shouldn't show two chips.
  return [...new Map(chips.map((c) => [c.key, c])).values()]
}

function labelForLock(reason) {
  return { daily_limit: "Time's up", restricted_time: 'Restricted time', schedule: 'On a break' }[reason] ?? 'Locked'
}

/**
 * ChildrenOverview — the family at a glance: one card per child with
 * today's screen time against their limit, what is restricting them right
 * now, whether the device's permissions are actually in place, and unread
 * alerts.
 *
 * Rendered by ParentalControlPage. There is deliberately no separate
 * "dashboard" page any more — one screen, not two showing the same list.
 *
 * `reloadKey` lets the parent re-fetch after adding a child.
 */
export default function ChildrenOverview({ onAddChild, reloadKey = 0 }) {
  const navigate = useNavigate()
  const toast = useToastStore()
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [childData, setChildData] = useState({})

  const load = useCallback(async () => {
    try {
      const childrenList = await listChildren()
      setChildren(childrenList)

      // One round of parallel fetches per child instead of a serial loop —
      // a family with four children used to wait for four sequential trips.
      const results = await Promise.all(
        childrenList.map(async (child) => {
          const [usage, alerts, devices, rule] = await Promise.all([
            getTodayUsage(child.id).catch(() => []),
            listAlerts(child.id, { limit: 5 }).catch(() => []),
            listDevices(child.id).catch(() => []),
            getScreenTimeRule(child.id).catch(() => null),
          ])
          return [child.id, {
            usage,
            alerts,
            devices,
            // Honour daily_limits_by_dow — a child with "no limit on
            // Saturday" must not be shown against the weekday number.
            limitMin: limitForDay(rule, new Date().getDay()),
            totalMs: usage.reduce((sum, u) => sum + (u.total_foreground_ms || 0), 0),
            unreadAlerts: alerts.filter((a) => !a.is_read).length,
            onlineDevices: devices.filter((d) => d.is_active && isDeviceOnline(d)).length,
          }]
        }),
      )
      setChildData(Object.fromEntries(results))
    } catch (error) {
      toast.error('Could not load dashboard', error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load, reloadKey])

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading…</div>

  const totalAlerts = Object.values(childData).reduce((sum, d) => sum + d.unreadAlerts, 0)
  const needsAttention = children.filter((c) => {
    const d = childData[c.id]
    return d && protectionMeta(d.devices)?.variant !== 'tulasi'
  })

  return (
    <div className="space-y-5">
      <p className="text-sm text-secondary-token">
        {children.length === 0
          ? 'No children set up yet'
          : `${children.length} child${children.length === 1 ? '' : 'ren'}${totalAlerts > 0 ? ` · ${totalAlerts} new alert${totalAlerts === 1 ? '' : 's'}` : ''}`}
      </p>

      {needsAttention.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 leading-relaxed">
            <span className="font-semibold">
              {needsAttention.map((c) => c.display_name).join(', ')}
            </span>{' '}
            {needsAttention.length === 1 ? "isn't" : "aren't"} fully protected — open the child and check
            Devices → Diagnostics. Rules can&apos;t be enforced until every permission is on.
          </p>
        </div>
      )}

      {children.length === 0 ? (
        <Card>
          <CardBody className="py-16 text-center">
            <ShieldCheck className="w-12 h-12 text-muted-token mx-auto mb-4" />
            <p className="text-base font-semibold text-secondary-token">No children yet</p>
            <p className="text-sm text-muted-token mt-2 max-w-xs mx-auto">
              Add a child, then pair their phone with a code to start managing screen time.
            </p>
            <Button size="sm" icon={Plus} className="mt-5" onClick={onAddChild}>
              Add your first child
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {children.map((child) => {
            const d = childData[child.id] ?? { devices: [], alerts: [], totalMs: 0, unreadAlerts: 0, onlineDevices: 0, limitMin: null }
            const protection = protectionMeta(d.devices)
            const ProtIcon = protection?.icon ?? ShieldCheck
            const usedMin = Math.round(d.totalMs / 60000)
            const pct = d.limitMin ? Math.min(100, (usedMin / d.limitMin) * 100) : null
            const over = d.limitMin != null && usedMin >= d.limitMin
            const chips = liveState(d.devices, child)

            return (
              <Card key={child.id} hover onClick={() => navigate(`/parental-control/${child.id}`)}>
                <CardBody className="pt-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar name={child.display_name} size="lg" />
                      {d.onlineDevices > 0 && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-tulasi-500 border-2 border-[var(--surface-elevated)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-primary-token truncate text-lg">{child.display_name}</h3>
                      <p className="text-sm text-secondary-token flex items-center gap-1.5 mt-1">
                        <Smartphone className="w-4 h-4" />
                        {d.devices.length === 0
                          ? 'No device paired'
                          : `${d.onlineDevices > 0 ? 'Online' : 'Offline'} · ${d.devices.length} device${d.devices.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <ChevronRight className="w-6 h-6 text-muted-token shrink-0" />
                  </div>

                  {/* Screen time today */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-sm text-secondary-token">Screen time today</span>
                      <span className={`text-lg font-bold tabular-nums ${over ? 'text-red-600' : 'text-primary-token'}`}>
                        {formatDuration(d.totalMs)}
                        {d.limitMin != null && (
                          <span className="text-sm font-medium text-muted-token"> / {formatDuration(d.limitMin * 60000)}</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-[var(--surface-muted)] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${over ? 'bg-red-500' : 'bg-indigo-500'}`}
                        style={{ width: `${pct ?? Math.min(100, usedMin / 3)}%` }}
                      />
                    </div>
                    {d.limitMin == null && (
                      <p className="text-xs text-muted-token mt-2">No daily limit set</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {protection && (
                      <Badge variant={protection.variant}>
                        <ProtIcon className="w-3.5 h-3.5" /> {protection.label}
                      </Badge>
                    )}
                    {chips.map((c) => (
                      <Badge key={c.key} variant={c.variant}>
                        <c.icon className="w-3.5 h-3.5" /> {c.label}
                      </Badge>
                    ))}
                    {d.unreadAlerts > 0 && (
                      <Badge variant="red">
                        <AlertTriangle className="w-3.5 h-3.5" /> {d.unreadAlerts}
                      </Badge>
                    )}
                  </div>

                  {d.alerts.length > 0 && (
                    <div className="pt-4 border-t border-[var(--border-color)]">
                      <p className="text-xs uppercase tracking-wide font-semibold text-muted-token mb-1.5">Latest</p>
                      <p className="text-sm text-secondary-token truncate">{d.alerts[0].title}</p>
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
