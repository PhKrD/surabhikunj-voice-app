import { useEffect, useMemo, useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import { useCachedQuery, invalidateCache } from '@/lib/useCachedQuery'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { formatDate, cn } from '@/lib/utils'
import NotificationPreferences from './NotificationPreferences'

const { Bell, CheckCheck, Search, Inbox, SlidersHorizontal } = LucideIcons

const GROUP_LABELS = {
  services: 'Services',
  sadhana: 'Sadhana',
  cleanliness: 'Cleanliness',
  announcements: 'Announcements',
  events: 'Events',
  personal: 'Personal',
  system: 'System',
}

const GROUP_ORDER = ['services', 'sadhana', 'cleanliness', 'announcements', 'events', 'personal', 'system']

function iconFor(category) {
  const Resolved = category?.icon ? LucideIcons[category.icon] : null
  return Resolved ?? LucideIcons.Bell
}

export default function NotificationsPage() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()

  const [tab, setTab] = useState('inbox')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')

  const { data: items = [], loading, refetch } = useCachedQuery(
    profile ? `notifications:${profile.id}` : null,
    async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('profile_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100)
      return data ?? []
    }
  )

  const { data: categories = [] } = useCachedQuery('notif:categories', async () => {
    const { data } = await supabase
      .from('notification_categories')
      .select('*')
      .order('sort_order')
    return data ?? []
  })

  useEffect(() => {
    if (!profile?.id) return undefined
    const channel = supabase
      .channel(`notif-page-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.id}` },
        () => {
          refetch()
          invalidateCache(`notif:unread:${profile.id}`)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id, refetch])

  const categoryMap = useMemo(
    () => Object.fromEntries((categories ?? []).map((c) => [c.key, c])),
    [categories]
  )

  const groupsPresent = useMemo(() => {
    const seen = new Set()
    for (const n of items) {
      const cat = categoryMap[n.category_key]
      if (cat?.group_key) seen.add(cat.group_key)
    }
    const ordered = GROUP_ORDER.filter((g) => seen.has(g))
    const extras = [...seen].filter((g) => !GROUP_ORDER.includes(g))
    return [...ordered, ...extras]
  }, [items, categoryMap])

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((n) => {
      if (group !== 'all') {
        const cat = categoryMap[n.category_key]
        if (cat?.group_key !== group) return false
      }
      if (q) {
        const hay = `${n.title ?? ''} ${n.body ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, group, query, categoryMap])

  const markAllRead = async () => {
    if (!profile) return
    await supabase.rpc('mark_notifications_read', { p_ids: null })
    refetch()
    invalidateCache(`notif:unread:${profile.id}`)
  }

  const handleOpen = async (item) => {
    if (!item.is_read) {
      await supabase.rpc('mark_notifications_read', { p_ids: [item.id] })
      invalidateCache(`notif:unread:${profile?.id}`)
      refetch()
    }
    if (item.action_url) navigate(item.action_url)
  }

  const chips = ['all', ...groupsPresent]

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-primary-token">Notifications</h2>
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--surface-muted)] w-full sm:w-auto">
          <button
            onClick={() => setTab('inbox')}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all flex-1 sm:flex-none',
              tab === 'inbox' ? 'bg-[var(--surface)] text-saffron-600 shadow-sm' : 'text-secondary-token hover:text-primary-token'
            )}
          >
            <Inbox className="w-4 h-4" />
            Inbox
          </button>
          <button
            onClick={() => setTab('prefs')}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all flex-1 sm:flex-none',
              tab === 'prefs' ? 'bg-[var(--surface)] text-saffron-600 shadow-sm' : 'text-secondary-token hover:text-primary-token'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Preferences
          </button>
        </div>
      </div>

      {tab === 'prefs' ? (
        <NotificationPreferences />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notifications…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--surface)] text-sm text-primary-token placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-saffron-300 transition"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={CheckCheck}
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="w-full sm:w-auto flex-shrink-0"
            >
              Mark all read
            </Button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
            {chips.map((chip) => {
              const active = group === chip
              const label = chip === 'all' ? 'All' : GROUP_LABELS[chip] ?? chip
              return (
                <button
                  key={chip}
                  onClick={() => setGroup(chip)}
                  className={cn(
                    'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors',
                    active
                      ? 'bg-saffron-500 text-white border-saffron-500'
                      : 'bg-[var(--surface)] text-secondary-token border-[var(--border-color)] hover:border-slate-300'
                  )}
                >
                  {label}
                  {chip === 'all' && unreadCount > 0 && (
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold',
                        active ? 'bg-white/25 text-white' : 'bg-saffron-100 text-saffron-700'
                      )}
                    >
                      {unreadCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-token text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardBody>
                <div className="flex flex-col items-center py-10 text-muted-token">
                  <Bell className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">
                    {items.length === 0 ? 'No notifications yet.' : 'No notifications match your search.'}
                  </p>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => {
                const cat = categoryMap[item.category_key]
                const Icon = iconFor(cat)
                return (
                  <Card key={item.id} className={item.is_read ? 'opacity-80' : 'border-saffron-200'}>
                    <CardBody className="py-4">
                      <button
                        onClick={() => handleOpen(item)}
                        className="w-full text-left flex items-start gap-3"
                      >
                        <div
                          className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                            item.is_read ? 'bg-[var(--surface-muted)] text-secondary-token' : 'bg-saffron-50 text-saffron-600'
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-primary-token text-sm">{item.title}</p>
                            {!item.is_read && <Badge variant="saffron">New</Badge>}
                          </div>
                          {cat?.label && (
                            <p className="text-[11px] font-semibold text-saffron-600 mt-0.5">{cat.label}</p>
                          )}
                          {item.body && <p className="text-sm text-secondary-token mt-0.5">{item.body}</p>}
                          <p className="text-xs text-muted-token mt-1.5">{formatDate(item.created_at)}</p>
                        </div>
                      </button>
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
