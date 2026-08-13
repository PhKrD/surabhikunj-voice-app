import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  HeartHandshake, Plus, X, Calendar, Clock, MapPin, MessageCircle,
  CheckCircle2, ShieldCheck, CalendarClock, Inbox, ChevronDown, ChevronUp,
  Repeat, UserCog, Ban,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { cn, formatTime } from '@/lib/utils'
import { shareToWhatsApp } from '@/lib/whatsapp'

const MODULE = 'service'

const INPUT_CLASS = 'w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

const PRIORITY_BADGE = {
  urgent: 'red',
  high: 'yellow',
  normal: 'default',
  low: 'default',
}

const STATUS_BADGE = {
  assigned: { label: 'Assigned', variant: 'default' },
  accepted: { label: 'Accepted', variant: 'blue' },
  declined: { label: 'Declined', variant: 'red' },
  in_progress: { label: 'In Progress', variant: 'saffron' },
  completed: { label: 'Completed', variant: 'cyan' },
  verified: { label: 'Verified', variant: 'tulasi' },
  cancelled: { label: 'Cancelled', variant: 'default' },
}

const RECURRENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const emptyForm = {
  title: '',
  user_id: '',
  task_date: '',
  task_time: '',
  priority: 'normal',
  requires_acceptance: false,
  coordinator_id: '',
  instructions: '',
  repeat: false,
  from_date: '',
  to_date: '',
  recurrence: 'daily',
}

function capitalize(value) {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function memberLabel(member) {
  if (!member) return 'Unknown'
  return member.display_name ?? member.spiritual_name ?? member.legal_name ?? member.email ?? 'Unknown'
}

function isValidDateString(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
}

function formatWhen(assignment) {
  if (!assignment?.task_date) return ''
  let out
  if (isValidDateString(assignment.task_date)) {
    try {
      out = format(parseISO(assignment.task_date), 'EEE, dd MMM yyyy')
    } catch {
      out = String(assignment.task_date)
    }
  } else {
    out = String(assignment.task_date)
  }
  if (assignment.task_time && typeof assignment.task_time === 'string') {
    try {
      out += ` \u00b7 ${formatTime(assignment.task_time)}`
    } catch {
      // ignore time formatting errors
    }
  }
  return out
}

function PriorityBadge({ priority }) {
  const key = priority ?? 'normal'
  return <Badge variant={PRIORITY_BADGE[key] ?? 'default'}>{capitalize(key)}</Badge>
}

function StatusBadge({ status }) {
  const cfg = STATUS_BADGE[status] ?? { label: capitalize(status), variant: 'default' }
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}

function EmptyState({ icon: Icon, message }) {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-col items-center py-10 text-slate-400">
          <Icon className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{message}</p>
        </div>
      </CardBody>
    </Card>
  )
}

function ServiceCard({ assignment, busy, onRespond }) {
  const a = assignment
  const [showInstructions, setShowInstructions] = useState(false)

  const requiresAccept = a.requires_acceptance && a.status === 'assigned'
  const canComplete =
    a.status === 'accepted' ||
    a.status === 'in_progress' ||
    (a.status === 'assigned' && !a.requires_acceptance)
  const hasContact = Boolean(a.coordinator_id) && Boolean(a.coordinator_phone)

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardBody className="py-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{a.title}</p>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{formatWhen(a)}</span>
              </div>
              {a.area_name && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{a.area_name}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <StatusBadge status={a.status} />
              <PriorityBadge priority={a.priority} />
            </div>
          </div>

          {a.instructions && (
            <div>
              <button
                type="button"
                onClick={() => setShowInstructions((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-saffron-600 hover:text-saffron-700"
              >
                {showInstructions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showInstructions ? 'Hide instructions' : 'View instructions'}
              </button>
              {showInstructions && (
                <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-xl px-3 py-2">
                  {a.instructions}
                </p>
              )}
            </div>
          )}

          {a.coordinator_name && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar name={a.coordinator_name} size="sm" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Coordinator</p>
                  <p className="text-sm text-slate-700 truncate">{a.coordinator_name}</p>
                </div>
              </div>
              {hasContact && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={MessageCircle}
                  onClick={() => shareToWhatsApp({ to: a.coordinator_phone, message: `Regarding service: ${a.title}` })}
                >
                  Contact
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {requiresAccept && (
              <>
                <Button size="sm" variant="tulasi" loading={busy} onClick={() => onRespond(a.id, 'accept')}>
                  Accept
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRespond(a.id, 'decline')}>
                  Decline
                </Button>
              </>
            )}
            {canComplete && (
              <Button size="sm" loading={busy} onClick={() => onRespond(a.id, 'complete')}>
                Mark Complete
              </Button>
            )}
            {a.status === 'completed' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Clock className="w-3.5 h-3.5" /> Awaiting verification
              </span>
            )}
            {a.status === 'verified' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tulasi-600">
                <ShieldCheck className="w-4 h-4" /> Verified
              </span>
            )}
            {a.status === 'declined' && (
              <span className="text-xs font-medium text-red-500">You declined this seva</span>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  )
}

function ManageCard({ assignment, members, canVerify, busy, onReassign, onCancel, onVerify }) {
  const a = assignment
  const [reassigning, setReassigning] = useState(false)
  const [pick, setPick] = useState(a.user_id ?? '')

  const submitReassign = () => {
    if (!pick || pick === a.user_id) {
      setReassigning(false)
      return
    }
    onReassign(a.id, pick)
    setReassigning(false)
  }

  return (
    <Card>
      <CardBody className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{a.title}</p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{formatWhen(a)}</span>
            </div>
            {a.area_name && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{a.area_name}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={a.status} />
            <PriorityBadge priority={a.priority} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <Avatar name={a.assignee_name} url={a.assignee_avatar} size="sm" />
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Assigned to</p>
            <p className="text-sm text-slate-700 truncate">{a.assignee_name ?? 'Unassigned'}</p>
          </div>
        </div>

        {reassigning ? (
          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className={cn(INPUT_CLASS, 'mt-0 flex-1')}
            >
              <option value="">Select devotee…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{memberLabel(m)}</option>
              ))}
            </select>
            <Button size="sm" loading={busy} onClick={submitReassign}>Save</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => { setReassigning(false); setPick(a.user_id ?? '') }}
            >
              Cancel
            </Button>
          </div>
        ) : a.status !== 'cancelled' && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="secondary" icon={UserCog} disabled={busy} onClick={() => setReassigning(true)}>
              Reassign
            </Button>
            {canVerify && a.status === 'completed' && (
              <Button size="sm" variant="tulasi" icon={ShieldCheck} loading={busy} onClick={() => onVerify(a.id)}>
                Verify
              </Button>
            )}
            <Button size="sm" variant="danger" icon={Ban} disabled={busy} onClick={() => onCancel(a.id, a.title)}>
              Cancel
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function NewServiceForm({ members, orgId, assignedBy, onCreated }) {
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const submit = async () => {
    if (!orgId) return
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.user_id) { setError('Please choose who to assign this to.'); return }
    if (form.repeat) {
      if (!form.from_date || !form.to_date) { setError('Recurring services need a from and to date.'); return }
    } else if (!form.task_date) {
      setError('Please choose a date.')
      return
    }

    setError('')
    setSaving(true)
    try {
      if (form.repeat) {
        const { data: template, error: templateError } = await supabase
          .from('task_templates')
          .insert({
            org_id: orgId,
            name: form.title.trim(),
            module_key: MODULE,
            recurrence: form.recurrence,
            default_time: form.task_time || null,
            priority: form.priority,
            coordinator_id: form.coordinator_id || null,
            requires_acceptance: form.requires_acceptance,
            instructions: form.instructions.trim() || null,
            is_active: true,
          })
          .select('id')
          .single()
        if (templateError) throw templateError

        const { data: count, error: generateError } = await supabase.rpc('generate_assignments_from_template', {
          p_template_id: template.id,
          p_user_id: form.user_id,
          p_from: form.from_date,
          p_to: form.to_date,
          p_area_id: null,
        })
        if (generateError) throw generateError

        const created = count ?? 0
        toastSuccess('Recurring service scheduled', `${created} assignment${created === 1 ? '' : 's'} created`)
      } else {
        const { error: insertError } = await supabase.from('task_assignments').insert({
          org_id: orgId,
          module_key: MODULE,
          user_id: form.user_id,
          assigned_by: assignedBy,
          status: 'assigned',
          title: form.title.trim(),
          instructions: form.instructions.trim() || null,
          task_date: form.task_date,
          task_time: form.task_time || null,
          priority: form.priority,
          requires_acceptance: form.requires_acceptance,
          coordinator_id: form.coordinator_id || null,
        })
        if (insertError) throw insertError
        toastSuccess('Service assigned')
      }

      setForm(emptyForm)
      onCreated()
    } catch (e) {
      setError(e.message)
      toastError('Could not create service', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardBody className="py-4 space-y-3">
        <p className="text-sm font-semibold text-slate-700">New Service</p>

        <label className="block">
          <span className="text-xs text-slate-500">Title</span>
          <input
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Evening arati seva"
            className={INPUT_CLASS}
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-500">Assignee</span>
            <select value={form.user_id} onChange={(e) => set({ user_id: e.target.value })} className={INPUT_CLASS}>
              <option value="">Select devotee…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{memberLabel(m)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Coordinator (optional)</span>
            <select value={form.coordinator_id} onChange={(e) => set({ coordinator_id: e.target.value })} className={INPUT_CLASS}>
              <option value="">None</option>
              {members.map((m) => <option key={m.id} value={m.id}>{memberLabel(m)}</option>)}
            </select>
          </label>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-slate-500">{form.repeat ? 'Date (single, unused)' : 'Date'}</span>
            <input
              type="date"
              value={form.task_date}
              onChange={(e) => set({ task_date: e.target.value })}
              disabled={form.repeat}
              className={cn(INPUT_CLASS, form.repeat && 'opacity-50')}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Time (optional)</span>
            <input type="time" value={form.task_time} onChange={(e) => set({ task_time: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Priority</span>
            <select value={form.priority} onChange={(e) => set({ priority: e.target.value })} className={INPUT_CLASS}>
              {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{capitalize(p)}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-slate-500">Instructions</span>
          <textarea
            value={form.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
            rows={3}
            className={cn(INPUT_CLASS, 'resize-none')}
          />
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.requires_acceptance}
            onChange={(e) => set({ requires_acceptance: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300 accent-saffron-500"
          />
          <span className="text-sm text-slate-600">Requires acceptance by the devotee</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.repeat}
            onChange={(e) => set({ repeat: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300 accent-saffron-500"
          />
          <span className="text-sm text-slate-600 inline-flex items-center gap-1">
            <Repeat className="w-3.5 h-3.5" /> Repeat on a schedule
          </span>
        </label>

        {form.repeat && (
          <div className="grid sm:grid-cols-3 gap-3 rounded-2xl bg-saffron-50 p-3">
            <label className="block">
              <span className="text-xs text-slate-500">From</span>
              <input type="date" value={form.from_date} onChange={(e) => set({ from_date: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">To</span>
              <input type="date" value={form.to_date} onChange={(e) => set({ to_date: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Recurrence</span>
              <select value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value })} className={INPUT_CLASS}>
                {RECURRENCE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}

        <div>
          <Button size="sm" onClick={submit} loading={saving}>
            {form.repeat ? 'Schedule Services' : 'Assign Service'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

export default function ServicesPage() {
  const { profile } = useAuthStore()
  const { org, hasPermission } = useOrgStore()
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const orgId = org?.id
  const canManage = hasPermission('tasks.assign') || hasPermission('tasks.manage')
  const canVerify = hasPermission('tasks.verify') || hasPermission('tasks.manage')

  const [tab, setTab] = useState('upcoming')
  const [mine, setMine] = useState([])
  const [all, setAll] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) {
      setMine([])
      setAll([])
      setMembers([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const mineRes = await supabase.rpc('my_assignments', { p_module: MODULE, p_scope: 'mine' })
      if (mineRes.error) throw mineRes.error
      setMine(mineRes.data ?? [])

      if (canManage) {
        const [allRes, membersRes] = await Promise.all([
          supabase.rpc('my_assignments', { p_module: MODULE, p_scope: 'all' }),
          supabase.rpc('org_members'),
        ])
        if (allRes.error) throw allRes.error
        if (membersRes.error) throw membersRes.error
        setAll(allRes.data ?? [])
        setMembers(membersRes.data ?? [])
      }
    } catch (e) {
      toastError('Could not load services', e.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, canManage, toastError])

  useEffect(() => { load() }, [load])

  const respond = async (id, action) => {
    setBusyId(id)
    try {
      const { error } = await supabase.rpc('respond_to_assignment', { p_assignment_id: id, p_action: action })
      if (error) throw error
      await load()
      const messages = {
        accept: 'Service accepted',
        decline: 'Service declined',
        start: 'Service started',
        complete: 'Marked as complete',
      }
      toastSuccess(messages[action] ?? 'Service updated')
    } catch (e) {
      toastError('Could not update service', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const reassign = async (id, userId) => {
    setBusyId(id)
    try {
      const { error } = await supabase.from('task_assignments').update({ user_id: userId }).eq('id', id)
      if (error) throw error
      await load()
      toastSuccess('Service reassigned')
    } catch (e) {
      toastError('Could not reassign service', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const cancel = async (id, title) => {
    const ok = window.confirm(`Cancel service "${title}"? The assignee will be notified.`)
    if (!ok) return
    setBusyId(id)
    try {
      const { error } = await supabase.from('task_assignments').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
      await load()
      toastSuccess('Service cancelled')
    } catch (e) {
      toastError('Could not cancel service', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const verify = async (id) => {
    setBusyId(id)
    try {
      const { error } = await supabase.rpc('verify_assignment', { p_assignment_id: id, p_approve: true })
      if (error) throw error
      await load()
      toastSuccess('Service verified')
    } catch (e) {
      toastError('Could not verify service', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  const upcoming = useMemo(() => (
    (mine ?? [])
      .filter((a) => a && typeof a.task_date === 'string' && ['assigned', 'accepted', 'in_progress'].includes(a?.status) && a.task_date >= today)
      .sort((x, y) => (
        x.task_date === y.task_date
          ? String(x.task_time ?? '').localeCompare(String(y.task_time ?? ''))
          : x.task_date.localeCompare(y.task_date)
      ))
  ), [mine, today])

  const completed = useMemo(() => (
    (mine ?? [])
      .filter((a) => a && typeof a.task_date === 'string' && (['completed', 'verified'].includes(a?.status) || a.task_date < today))
      .sort((x, y) => (
        x.task_date === y.task_date
          ? String(y.task_time ?? '').localeCompare(String(x.task_time ?? ''))
          : y.task_date.localeCompare(x.task_date)
      ))
  ), [mine, today])

  const allSorted = useMemo(() => (
    [...(all ?? [])].sort((x, y) => (
      x.task_date === y.task_date
        ? String(y.task_time ?? '').localeCompare(String(x.task_time ?? ''))
        : String(y.task_date ?? '').localeCompare(String(x.task_date ?? ''))
    ))
  ), [all])

  const tabs = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
    ...(canManage ? [{ key: 'manage', label: 'Manage' }] : []),
  ]

  const activeTab = tab === 'manage' && !canManage ? 'upcoming' : tab

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading services…</div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-2xl grad-saffron flex items-center justify-center flex-shrink-0">
            <HeartHandshake className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-bold text-slate-800">IM Services</h2>
        </div>
        {canManage && activeTab === 'manage' && (
          <Button size="sm" icon={showForm ? X : Plus} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'New Service'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
              activeTab === t.key
                ? 'bg-saffron-500 text-white shadow-sm'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'upcoming' && (
        <div className="space-y-3">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} message="No upcoming services right now." />
          ) : (
            upcoming.map((a) => (
              <ServiceCard key={a.id} assignment={a} busy={busyId === a.id} onRespond={respond} />
            ))
          )}
        </div>
      )}

      {activeTab === 'completed' && (
        <div className="space-y-3">
          {completed.length === 0 ? (
            <EmptyState icon={CheckCircle2} message="No completed services yet." />
          ) : (
            completed.map((a) => (
              <ServiceCard key={a.id} assignment={a} busy={busyId === a.id} onRespond={respond} />
            ))
          )}
        </div>
      )}

      {activeTab === 'manage' && canManage && (
        <div className="space-y-4">
          {showForm && (
            <NewServiceForm
              members={members}
              orgId={orgId}
              assignedBy={profile?.id}
              onCreated={() => { setShowForm(false); load() }}
            />
          )}

          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">All services ({allSorted.length})</p>
            {allSorted.length === 0 ? (
              <EmptyState icon={Inbox} message="No services assigned yet." />
            ) : (
              allSorted.map((a) => (
                <ManageCard
                  key={a.id}
                  assignment={a}
                  members={members}
                  canVerify={canVerify}
                  busy={busyId === a.id}
                  onReassign={reassign}
                  onCancel={cancel}
                  onVerify={verify}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
