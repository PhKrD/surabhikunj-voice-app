import { useState, useEffect, useCallback, useMemo } from 'react'
import { Megaphone, Send, Clock, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import BroadcastCompose from './BroadcastCompose'
import BroadcastScheduled from './BroadcastScheduled'
import BroadcastDelivery from './BroadcastDelivery'

const TABS = [
  { key: 'compose', label: 'Compose', icon: Send },
  { key: 'scheduled', label: 'Scheduled', icon: Clock },
  { key: 'delivery', label: 'Delivery', icon: CheckCircle2 },
]

export default function BroadcastPage() {
  const { org, hasPermission } = useOrgStore()
  const toast = useToastStore()
  const orgId = org?.id
  const canBroadcast = hasPermission('announcements.manage') || hasPermission('members.manage')

  const [tab, setTab] = useState('compose')
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [categories, setCategories] = useState([])

  const loadMembers = useCallback(async () => {
    setMembersLoading(true)
    try {
      const { data, error } = await supabase.rpc('org_members')
      if (error) throw error
      setMembers(data ?? [])
    } catch (err) {
      toast.error('Could not load devotees', err.message)
    } finally {
      setMembersLoading(false)
    }
  }, [toast])

  const loadCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notification_categories')
        .select('key, label, group_key, sort_order')
        .order('sort_order')
      if (error) throw error
      setCategories(data ?? [])
    } catch (err) {
      toast.error('Could not load categories', err.message)
    }
  }, [toast])

  useEffect(() => {
    if (!canBroadcast) return
    loadMembers()
    loadCategories()
  }, [canBroadcast, loadMembers, loadCategories])

  const memberById = useMemo(() => {
    const map = {}
    for (const row of members) map[row.id] = row
    return map
  }, [members])

  const categoryByKey = useMemo(() => {
    const map = {}
    for (const c of categories) map[c.key] = c
    return map
  }, [categories])

  if (!canBroadcast) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-12 text-muted-token">
              <Megaphone className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">You do not have access to broadcasts.</p>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl grad-saffron flex items-center justify-center flex-shrink-0 shadow-[0_8px_20px_-6px_rgba(249,115,22,0.5)]">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-primary-token">Broadcasts</h1>
          <p className="text-xs text-muted-token">Send announcements and reminders to devotees</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
              tab === t.key
                ? 'bg-saffron-500 text-white shadow-sm'
                : 'bg-[var(--surface)] text-secondary-token border border-[var(--border-color)] hover:border-slate-300'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'compose' && (
        <BroadcastCompose
          orgId={orgId}
          members={members}
          membersLoading={membersLoading}
          categories={categories}
        />
      )}
      {tab === 'scheduled' && (
        <BroadcastScheduled orgId={orgId} memberById={memberById} categoryByKey={categoryByKey} />
      )}
      {tab === 'delivery' && (
        <BroadcastDelivery orgId={orgId} memberById={memberById} categoryByKey={categoryByKey} />
      )}
    </div>
  )
}
