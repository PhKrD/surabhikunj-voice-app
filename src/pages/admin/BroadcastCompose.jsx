import { useState, useEffect, useMemo, useCallback } from 'react'
import { Send, Clock, Users, Building2, CheckCircle2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

const FIELD_CLS =
  'w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--surface)] text-sm text-primary-token placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

const AUDIENCE = [
  { key: 'everyone', label: 'Everyone', icon: Users },
  { key: 'department', label: 'By department', icon: Building2 },
  { key: 'selected', label: 'Selected members', icon: CheckCircle2 },
]

const TIMING = [
  { key: 'now', label: 'Send now', icon: Send },
  { key: 'later', label: 'Schedule for later', icon: Clock },
]

function memberLabel(m) {
  return m?.display_name ?? m?.spiritual_name ?? m?.legal_name ?? m?.email ?? 'Unnamed'
}

function titleCase(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function devoteeWord(n) {
  return n === 1 ? 'devotee' : 'devotees'
}

export default function BroadcastCompose({ orgId, members, membersLoading, categories }) {
  const toast = useToastStore()

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('announcement.new')
  const [timing, setTiming] = useState('now')
  const [sendAt, setSendAt] = useState('')
  const [audience, setAudience] = useState('everyone')
  const [departments, setDepartments] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [deptMemberIds, setDeptMemberIds] = useState([])
  const [deptMembersLoading, setDeptMembersLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('departments')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setDepartments(data ?? []))
  }, [orgId])

  useEffect(() => {
    if (audience !== 'department' || !departmentId) {
      setDeptMemberIds([])
      return undefined
    }
    let active = true
    setDeptMembersLoading(true)
    supabase
      .from('department_members')
      .select('profile_id')
      .eq('department_id', departmentId)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          toast.error('Could not load department members', error.message)
          setDeptMemberIds([])
        } else {
          setDeptMemberIds((data ?? []).map((r) => r.profile_id))
        }
        setDeptMembersLoading(false)
      })
    return () => {
      active = false
    }
  }, [audience, departmentId, toast])

  const groupedCategories = useMemo(() => {
    const groups = new Map()
    for (const c of categories) {
      if (!groups.has(c.group_key)) groups.set(c.group_key, [])
      groups.get(c.group_key).push(c)
    }
    return Array.from(groups.entries())
  }, [categories])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => memberLabel(m).toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
    )
  }, [members, search])

  const recipientIds = useMemo(() => {
    if (audience === 'everyone') return members.map((m) => m.id)
    if (audience === 'department') return deptMemberIds
    if (audience === 'selected') return selectedIds
    return []
  }, [audience, members, deptMemberIds, selectedIds])

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const selectAllShown = useCallback(() => {
    setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredMembers.map((m) => m.id)])))
  }, [filteredMembers])

  const resetAfterSend = () => {
    setTitle('')
    setMessage('')
    setSelectedIds([])
    setSendAt('')
  }

  const handleSubmit = async () => {
    if (!orgId) return
    const t = title.trim()
    const b = message.trim()
    if (!t || !b) {
      setFormError('Title and message are both required.')
      return
    }
    const ids = recipientIds
    if (ids.length === 0) {
      setFormError('Select at least one recipient before sending.')
      return
    }

    let sendAtIso = null
    if (timing === 'later') {
      if (!sendAt) {
        setFormError('Choose a date and time to schedule the broadcast.')
        return
      }
      const dt = new Date(sendAt)
      if (Number.isNaN(dt.getTime())) {
        setFormError('That schedule time is not valid.')
        return
      }
      if (dt.getTime() <= Date.now()) {
        setFormError('Schedule time must be in the future.')
        return
      }
      sendAtIso = dt.toISOString()
    }

    setFormError('')
    setSending(true)
    try {
      if (timing === 'now') {
        const { data, error } = await supabase.rpc('notify_many', {
          p_profile_ids: ids,
          p_category: category,
          p_title: t,
          p_body: b,
          p_reference_id: null,
          p_action_url: null,
          p_org_id: orgId,
        })
        if (error) throw error
        const count = data ?? 0
        toast.success(`Sent to ${count} ${devoteeWord(count)}`)
        resetAfterSend()
      } else {
        const results = await Promise.all(
          ids.map((pid) =>
            supabase.rpc('schedule_notification', {
              p_profile_id: pid,
              p_category: category,
              p_title: t,
              p_send_at: sendAtIso,
              p_body: b,
              p_reference_id: null,
              p_action_url: null,
              p_org_id: orgId,
            })
          )
        )
        const failed = results.filter((r) => r.error).length
        const ok = results.length - failed
        if (ok > 0) {
          toast.success(`Scheduled for ${ok} ${devoteeWord(ok)}`)
          resetAfterSend()
        }
        if (failed > 0) {
          const firstErr = results.find((r) => r.error)?.error?.message ?? ''
          toast.error(`${failed} could not be scheduled`, firstErr)
        }
      }
    } catch (err) {
      setFormError(err.message)
      toast.error('Broadcast failed', err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="py-4 space-y-3">
          <label className="block">
            <span className="text-xs text-secondary-token">
              Title<span className="text-red-500 ml-0.5">*</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ekadashi program this Saturday"
              className={FIELD_CLS}
            />
          </label>

          <label className="block">
            <span className="text-xs text-secondary-token">
              Message<span className="text-red-500 ml-0.5">*</span>
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Write the announcement devotees will receive…"
              className={`${FIELD_CLS} resize-none`}
            />
          </label>

          <label className="block">
            <span className="text-xs text-secondary-token">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD_CLS}>
              {groupedCategories.length === 0 && (
                <option value="announcement.new">Announcements</option>
              )}
              {groupedCategories.map(([groupKey, list]) => (
                <optgroup key={groupKey} label={titleCase(groupKey)}>
                  {list.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <span className="text-xs text-secondary-token">Send timing</span>
            <div className="flex flex-wrap items-center gap-2">
              {TIMING.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setTiming(o.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
                    timing === o.key
                      ? 'bg-saffron-500 text-white shadow-sm'
                      : 'bg-[var(--surface)] text-secondary-token border border-[var(--border-color)] hover:border-slate-300'
                  )}
                >
                  <o.icon className="w-3.5 h-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
            {timing === 'later' && (
              <label className="block">
                <span className="text-xs text-secondary-token">Send at</span>
                <input
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                  className={FIELD_CLS}
                />
              </label>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="py-4 space-y-3">
          <span className="text-xs text-secondary-token">Audience</span>
          <div className="grid grid-cols-3 gap-2">
            {AUDIENCE.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAudience(a.key)}
                className={cn(
                  'flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl border text-xs font-semibold transition-all',
                  audience === a.key
                    ? 'border-saffron-400 bg-saffron-50 text-saffron-700'
                    : 'border-[var(--border-color)] bg-[var(--surface)] text-secondary-token hover:border-slate-300'
                )}
              >
                <a.icon className="w-4 h-4" />
                <span className="text-center leading-tight">{a.label}</span>
              </button>
            ))}
          </div>

          {audience === 'department' && (
            <label className="block">
              <span className="text-xs text-secondary-token">Department</span>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className={FIELD_CLS}
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {departments.length === 0 && (
                <p className="text-xs text-muted-token mt-1">No departments available yet.</p>
              )}
            </label>
          )}

          {audience === 'selected' && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search devotees…"
                  className={cn(FIELD_CLS, 'mt-0 pl-9')}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={selectAllShown}
                  className="font-semibold text-saffron-600 hover:text-saffron-700"
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="font-semibold text-muted-token hover:text-secondary-token"
                >
                  Clear ({selectedIds.length})
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--border-color)] divide-y divide-[var(--border-color)]">
                {membersLoading ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-token">Loading devotees…</p>
                ) : filteredMembers.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-token">No devotees match your search.</p>
                ) : (
                  filteredMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--surface-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        className="w-4 h-4 rounded accent-saffron-500"
                      />
                      <Avatar name={memberLabel(m)} url={m.avatar_url} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm text-primary-token truncate">{memberLabel(m)}</p>
                        {m.email && <p className="text-xs text-muted-token truncate">{m.email}</p>}
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 text-sm">
            <Users className="w-4 h-4 text-saffron-500" />
            <span className="text-secondary-token">Will notify</span>
            <span className="font-bold text-saffron-600">
              {audience === 'department' && deptMembersLoading ? '…' : recipientIds.length}
            </span>
            <span className="text-secondary-token">{devoteeWord(recipientIds.length)}</span>
          </div>

          {formError ? (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {formError}
            </p>
          ) : null}

          <div className="pt-1">
            <Button
              onClick={handleSubmit}
              loading={sending}
              icon={timing === 'now' ? Send : Clock}
            >
              {timing === 'now' ? 'Send now' : 'Schedule broadcast'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
