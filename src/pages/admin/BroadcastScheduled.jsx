import { useState, useEffect, useCallback } from 'react'
import { Clock, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'

function memberLabel(m) {
  return m?.display_name ?? m?.spiritual_name ?? m?.legal_name ?? m?.email ?? 'Unnamed'
}

function formatClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function groupRows(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.title}||${r.send_at}||${r.category_key}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        title: r.title,
        body: r.body,
        send_at: r.send_at,
        category_key: r.category_key,
        ids: [],
        profileIds: [],
      })
    }
    const g = map.get(key)
    g.ids.push(r.id)
    g.profileIds.push(r.profile_id)
  }
  return Array.from(map.values())
}

export default function BroadcastScheduled({ orgId, memberById, categoryByKey }) {
  const toast = useToastStore()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancellingKey, setCancellingKey] = useState(null)

  const load = useCallback(async () => {
    if (!orgId) {
      setGroups([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('notification_schedule')
        .select('id, title, body, category_key, send_at, status, profile_id')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .gte('send_at', nowIso)
        .order('send_at', { ascending: true })
      if (error) throw error
      setGroups(groupRows(data ?? []))
    } catch (err) {
      toast.error('Could not load scheduled broadcasts', err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  useEffect(() => {
    load()
  }, [load])

  const cancelGroup = async (group) => {
    setCancellingKey(group.key)
    try {
      const { error } = await supabase
        .from('notification_schedule')
        .update({ status: 'cancelled' })
        .in('id', group.ids)
        .eq('status', 'pending')
      if (error) throw error
      await load()
      toast.success('Broadcast cancelled')
    } catch (err) {
      toast.error('Could not cancel broadcast', err.message)
    } finally {
      setCancellingKey(null)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading scheduled broadcasts…</div>
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center py-10 text-slate-400">
            <Clock className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No upcoming scheduled broadcasts.</p>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Upcoming ({groups.length})</h2>
      {groups.map((g) => {
        const count = g.ids.length
        const single = count === 1 ? memberById[g.profileIds[0]] : null
        const recipientText =
          count === 1 ? (single ? memberLabel(single) : '1 devotee') : `${count} devotees`
        return (
          <Card key={g.key}>
            <CardBody className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800 truncate">{g.title}</p>
                    <Badge variant="saffron">
                      {categoryByKey[g.category_key]?.label ?? g.category_key}
                    </Badge>
                  </div>
                  {g.body && <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{g.body}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(g.send_at)} · {formatClock(g.send_at)}
                    </span>
                    <Badge variant="default">
                      <Users className="w-3 h-3 mr-1" />
                      {recipientText}
                    </Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={X}
                  loading={cancellingKey === g.key}
                  onClick={() => cancelGroup(g)}
                >
                  Cancel
                </Button>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
