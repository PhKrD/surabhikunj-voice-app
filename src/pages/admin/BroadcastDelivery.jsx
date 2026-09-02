import { useState, useEffect, useMemo, useCallback } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'

const STATUS_ORDER = ['delivered', 'sent', 'queued', 'skipped', 'failed']

function memberLabel(m) {
  return m?.display_name ?? m?.spiritual_name ?? m?.legal_name ?? m?.email ?? 'Unnamed'
}

function statusVariant(status) {
  if (status === 'sent' || status === 'delivered') return 'tulasi'
  if (status === 'failed') return 'red'
  return 'default'
}

function sortStatuses(entries) {
  return entries.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a[0])
    const bi = STATUS_ORDER.indexOf(b[0])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

export default function BroadcastDelivery({ orgId, memberById, categoryByKey }) {
  const toast = useToastStore()
  const [notifs, setNotifs] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) {
      setNotifs([])
      setDeliveries([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nRes, dRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('id, profile_id, title, category_key, is_read, created_at')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('notification_deliveries')
          .select('id, notification_id, profile_id, channel, status, created_at')
          .order('created_at', { ascending: false })
          .limit(300),
      ])
      if (nRes.error) throw nRes.error
      if (dRes.error) throw dRes.error
      setNotifs(nRes.data ?? [])
      setDeliveries(dRes.data ?? [])
    } catch (err) {
      toast.error('Could not load delivery status', err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  useEffect(() => {
    load()
  }, [load])

  const channelAgg = useMemo(() => {
    const agg = {}
    for (const d of deliveries) {
      if (!agg[d.channel]) agg[d.channel] = {}
      agg[d.channel][d.status] = (agg[d.channel][d.status] ?? 0) + 1
    }
    return agg
  }, [deliveries])

  const deliveriesByNotif = useMemo(() => {
    const map = new Map()
    for (const d of deliveries) {
      if (!map.has(d.notification_id)) map.set(d.notification_id, [])
      map.get(d.notification_id).push(d)
    }
    return map
  }, [deliveries])

  const readCount = useMemo(() => notifs.filter((n) => n.is_read).length, [notifs])
  const unreadCount = notifs.length - readCount

  if (loading) {
    return <div className="text-center py-12 text-muted-token text-sm">Loading delivery status…</div>
  }

  if (notifs.length === 0 && deliveries.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center py-10 text-muted-token">
            <AlertCircle className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No notifications sent yet.</p>
          </div>
        </CardBody>
      </Card>
    )
  }

  const channels = Object.keys(channelAgg)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary-token">
            <CheckCircle2 className="w-4 h-4 text-saffron-500" />
            Delivery summary
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {channels.length === 0 ? (
            <p className="text-sm text-muted-token">No delivery records in the recent window.</p>
          ) : (
            <div className="space-y-2">
              {channels.map((channel) => (
                <div key={channel} className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-secondary-token capitalize w-16">{channel}</span>
                  {sortStatuses(Object.entries(channelAgg[channel])).map(([status, count]) => (
                    <Badge key={status} variant={statusVariant(status)}>
                      {status} {count}
                    </Badge>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="pt-3 mt-1 border-t border-[var(--border-color)] flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-secondary-token w-16">Read</span>
            <Badge variant="tulasi">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {readCount} read
            </Badge>
            <Badge variant="default">{unreadCount} unread</Badge>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold text-primary-token">Recent notifications ({notifs.length})</div>
        </CardHeader>
        <CardBody className="divide-y divide-[var(--border-color)]">
          {notifs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-token">No recent notifications visible.</p>
          ) : (
            notifs.map((n) => {
              const dels = deliveriesByNotif.get(n.id) ?? []
              const recipient = memberById[n.profile_id]
              return (
                <div key={n.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-primary-token truncate">{n.title}</p>
                      {n.category_key && (
                        <Badge variant="saffron">
                          {categoryByKey[n.category_key]?.label ?? n.category_key}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-token mt-0.5">
                      {formatDate(n.created_at)}
                      {recipient ? ` · ${memberLabel(recipient)}` : ''}
                    </p>
                    {dels.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {dels.map((d) => (
                          <Badge key={d.id} variant={statusVariant(d.status)}>
                            {d.channel}: {d.status}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Badge variant={n.is_read ? 'tulasi' : 'default'}>{n.is_read ? 'read' : 'unread'}</Badge>
                </div>
              )
            })
          )}
        </CardBody>
      </Card>
    </div>
  )
}
