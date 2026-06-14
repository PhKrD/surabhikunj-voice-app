import { useEffect, useState, useCallback } from 'react'
import { Bell, CheckCheck, Calendar, ListChecks, Sparkles, BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'

const iconByType = {
  sadhana: BookOpen,
  service: ListChecks,
  cleaning: Sparkles,
  event: Calendar,
  general: Bell,
}

export default function NotificationsPage() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setItems(data ?? [])
    setLoading(false)
  }, [profile])

  useEffect(() => {
    const id = setTimeout(() => {
      load()
    }, 0)

    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    if (!profile?.id) return undefined
    const channel = supabase
      .channel(`notif-page-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.id}` },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id, load])

  const markAllRead = async () => {
    if (!profile) return
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('profile_id', profile.id)
      .eq('is_read', false)
    setItems((prev) => prev.map((it) => ({ ...it, is_read: true })))
  }

  const markRead = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, is_read: true } : it)))
  }

  const handleOpen = async (item) => {
    if (!item.is_read) {
      await markRead(item.id)
    }

    if (item.type === 'event' && item.reference_id) {
      navigate('/events', { state: { referenceId: item.reference_id } })
      return
    }

    if (item.type === 'service' && item.reference_id) {
      navigate('/services', { state: { referenceId: item.reference_id } })
      return
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Notifications</h2>
        <Button size="sm" variant="secondary" icon={CheckCheck} onClick={markAllRead}>
          Mark all read
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <Bell className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No notifications yet.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const Icon = iconByType[item.type] ?? Bell
            return (
              <Card key={item.id} className={item.is_read ? 'opacity-80' : 'border-saffron-200'}>
                <CardBody className="py-4">
                  <button
                    onClick={() => handleOpen(item)}
                    className="w-full text-left flex items-start gap-3"
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.is_read ? 'bg-slate-100 text-slate-500' : 'bg-saffron-50 text-saffron-600'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
                        {!item.is_read && <Badge variant="saffron">New</Badge>}
                      </div>
                      {item.body && <p className="text-sm text-slate-500 mt-0.5">{item.body}</p>}
                      <p className="text-xs text-slate-400 mt-1.5">{formatDate(item.created_at)}</p>
                    </div>
                  </button>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
