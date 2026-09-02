import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, MapPin, Plus, CheckCircle2, Clock, Calendar } from 'lucide-react'
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
import AreasManager from './AreasManager'

const MODULE = 'cleanliness'

const INPUT_CLASS = 'w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

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

const emptyForm = {
  area_id: '',
  title: '',
  user_id: '',
  task_date: '',
  task_time: '',
  priority: 'normal',
  requires_acceptance: false,
  coordinator_id: '',
  instructions: '',
}

function capitalize(value) {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function memberLabel(member) {
  if (!member) return 'Unknown'
  return member.display_name ?? member.spiritual_name ?? member.legal_name ?? member.email ?? 'Unknown'
}

function formatWhen(assignment) {
  if (!assignment?.task_date) return ''
  let out
  try {
    out = format(parseISO(assignment.task_date), 'EEE, dd MMM yyyy')
  } catch {
    out = assignment.task_date
  }
  if (assignment.task_time) out += ` \u00b7 ${formatTime(assignment.task_time)}`
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
        <div className="flex flex-col items-center py-10 text-muted-token">
          <Icon className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{message}</p>
        </div>
      </CardBody>
    </Card>
  )
}

function AreaLine({ name }) {
  if (!name) return null
  return (
    <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-tulasi-700">
      <MapPin className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{name}</span>
    </div>
  )
}

function DutyCard({ assignment, busy, onRespond }) {
  const a = assignment

  const requiresAccept = a.requires_acceptance && a.status === 'assigned'
  const canComplete =
    a.status === 'accepted' ||
    a.status === 'in_progress' ||
    (a.status === 'assigned' && !a.requires_acceptance)

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardBody className="py-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-primary-token">{a.title || 'Cleaning duty'}</p>
              <AreaLine name={a.area_name} />
              <div className="flex items-center gap-1.5 text-xs text-secondary-token mt-1">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{formatWhen(a)}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <StatusBadge status={a.status} />
              <PriorityBadge priority={a.priority} />
            </div>
          </div>

          {a.instructions && (
            <p className="text-sm text-secondary-token whitespace-pre-wrap bg-[var(--surface-muted)] rounded-xl px-3 py-2">
              {a.instructions}
            </p>
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
              <Button size="sm" icon={CheckCircle2} loading={busy} onClick={() => onRespond(a.id, 'complete')}>
                Mark Done
              </Button>
            )}
            {a.status === 'completed' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-token">
                <Clock className="w-3.5 h-3.5" /> Awaiting verification
              </span>
            )}
            {a.status === 'verified' && (
              <Badge variant="tulasi">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Verified
              </Badge>
            )}
            {a.status === 'declined' && (
              <span className="text-xs font-medium text-red-500">You declined this duty</span>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  )
}

function TrackCard({ assignment, members, canVerify, busy, onReassign, onCancel, onVerify }) {
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
            <p className="font-semibold text-primary-token">{a.title || 'Cleaning duty'}</p>
            <AreaLine name={a.area_name} />
            <div className="flex items-center gap-1.5 text-xs text-secondary-token mt-1">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{formatWhen(a)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={a.status} />
            <PriorityBadge priority={a.priority} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border-color)] pt-3">
          <Avatar name={a.assignee_name} url={a.assignee_avatar} size="sm" />
          <div className="min-w-0">
            <p className="text-xs text-muted-token">Assigned to</p>
            <p className="text-sm text-primary-token truncate">{a.assignee_name ?? 'Unassigned'}</p>
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
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReassigning(true)}>
              Reassign
            </Button>
            {canVerify && a.status === 'completed' && (
              <>
                <Button size="sm" variant="tulasi" icon={CheckCircle2} loading={busy} onClick={() => onVerify(a.id, true)}>
                  Verify
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onVerify(a.id, false)}>
                  Send back
                </Button>
              </>
            )}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => onCancel(a.id, a.title)}>
              Cancel
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function AssignForm({ members, orgId, assignedBy, onCreated }) {
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const [areas, setAreas] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(true)
  const [form, setForm] = useState({ ...emptyForm, coordinator_id: assignedBy ?? '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    let active = true
    const loadAreas = async () => {
      if (!orgId) {
        setAreas([])
        setLoadingAreas(false)
        return
      }
      setLoadingAreas(true)
      const { data, error: areaError } = await supabase
        .from('task_areas')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (!active) return
      if (areaError) toastError('Could not load areas', areaError.message)
      setAreas(data ?? [])
      setLoadingAreas(false)
    }
    loadAreas()
    return () => { active = false }
  }, [orgId, toastError])

  useEffect(() => {
    if (assignedBy) setForm((f) => (f.coordinator_id ? f : { ...f, coordinator_id: assignedBy }))
  }, [assignedBy])

  const submit = async () => {
    if (!orgId) return
    if (!form.area_id) { setError('Please choose an area.'); return }
    if (!form.user_id) { setError('Please choose who to assign this to.'); return }
    if (!form.task_date) { setError('Please choose a date.'); return }

    setError('')
    setSaving(true)
    try {
      const area = areas.find((x) => x.id === form.area_id)
      const title = form.title.trim() || (area ? `${area.name} cleaning` : 'Cleaning duty')
      const { error: insertError } = await supabase.from('task_assignments').insert({
        org_id: orgId,
        module_key: MODULE,
        area_id: form.area_id,
        user_id: form.user_id,
        assigned_by: assignedBy,
        status: 'assigned',
        title,
        instructions: form.instructions.trim() || null,
        task_date: form.task_date,
        task_time: form.task_time || null,
        priority: form.priority,
        requires_acceptance: form.requires_acceptance,
        coordinator_id: form.coordinator_id || assignedBy || null,
      })
      if (insertError) throw insertError
      toastSuccess('Cleaning duty assigned')
      setForm({ ...emptyForm, coordinator_id: assignedBy ?? '' })
      onCreated()
    } catch (e) {
      setError(e.message)
      toastError('Could not assign duty', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardBody className="py-4 space-y-3">
        <p className="text-sm font-semibold text-primary-token">New cleaning duty</p>

        {loadingAreas ? (
          <p className="text-sm text-muted-token py-4">Loading areas…</p>
        ) : areas.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-token">
            <MapPin className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Add a cleaning area first, then assign duties here.</p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Area</span>
                <select value={form.area_id} onChange={(e) => set({ area_id: e.target.value })} className={INPUT_CLASS}>
                  <option value="">Select area…</option>
                  {areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Assignee</span>
                <select value={form.user_id} onChange={(e) => set({ user_id: e.target.value })} className={INPUT_CLASS}>
                  <option value="">Select devotee…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{memberLabel(m)}</option>)}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-secondary-token">Title (optional)</span>
              <input
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Defaults to the area name + cleaning"
                className={INPUT_CLASS}
              />
            </label>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Date</span>
                <input type="date" value={form.task_date} onChange={(e) => set({ task_date: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Time (optional)</span>
                <input type="time" value={form.task_time} onChange={(e) => set({ task_time: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Priority</span>
                <select value={form.priority} onChange={(e) => set({ priority: e.target.value })} className={INPUT_CLASS}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{capitalize(p)}</option>)}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-secondary-token">Coordinator (verifies completion)</span>
              <select value={form.coordinator_id} onChange={(e) => set({ coordinator_id: e.target.value })} className={INPUT_CLASS}>
                <option value="">None</option>
                {members.map((m) => <option key={m.id} value={m.id}>{memberLabel(m)}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-secondary-token">Instructions</span>
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
              <span className="text-sm text-secondary-token">Requires acceptance by the devotee</span>
            </label>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}

            <div>
              <Button size="sm" icon={Plus} onClick={submit} loading={saving}>Assign Duty</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

export default function CleanlinessPage() {
  const { profile } = useAuthStore()
  const { org, hasPermission } = useOrgStore()
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const orgId = org?.id
  const canManage = hasPermission('tasks.assign') || hasPermission('tasks.manage')
  const canVerify = hasPermission('tasks.verify') || hasPermission('tasks.manage')

  const [tab, setTab] = useState('mine')
  const [mine, setMine] = useState([])
  const [all, setAll] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

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
      toastError('Could not load cleaning duties', e.message)
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
        accept: 'Duty accepted',
        decline: 'Duty declined',
        start: 'Duty started',
        complete: 'Marked as done',
      }
      toastSuccess(messages[action] ?? 'Duty updated')
    } catch (e) {
      toastError('Could not update duty', e.message)
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
      toastSuccess('Duty reassigned')
    } catch (e) {
      toastError('Could not reassign duty', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const cancel = async (id, title) => {
    const ok = window.confirm(`Cancel "${title || 'this cleaning duty'}"? The assignee will be notified.`)
    if (!ok) return
    setBusyId(id)
    try {
      const { error } = await supabase.from('task_assignments').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
      await load()
      toastSuccess('Duty cancelled')
    } catch (e) {
      toastError('Could not cancel duty', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const verify = async (id, approve) => {
    setBusyId(id)
    try {
      const { error } = await supabase.rpc('verify_assignment', { p_assignment_id: id, p_approve: approve })
      if (error) throw error
      await load()
      toastSuccess(approve ? 'Duty verified' : 'Sent back to devotee')
    } catch (e) {
      toastError('Could not update duty', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  const myDuties = useMemo(() => (
    mine
      .filter((a) => ['assigned', 'accepted', 'in_progress'].includes(a.status) && a.task_date >= today)
      .sort((x, y) => (
        x.task_date === y.task_date
          ? (x.task_time ?? '').localeCompare(y.task_time ?? '')
          : x.task_date.localeCompare(y.task_date)
      ))
  ), [mine, today])

  const completed = useMemo(() => (
    mine
      .filter((a) => ['completed', 'verified'].includes(a.status) || a.task_date < today)
      .sort((x, y) => (
        x.task_date === y.task_date
          ? (y.task_time ?? '').localeCompare(x.task_time ?? '')
          : y.task_date.localeCompare(x.task_date)
      ))
  ), [mine, today])

  const allSorted = useMemo(() => (
    [...all].sort((x, y) => (
      x.task_date === y.task_date
        ? (y.task_time ?? '').localeCompare(x.task_time ?? '')
        : y.task_date.localeCompare(x.task_date)
    ))
  ), [all])

  const tabs = [
    { key: 'mine', label: 'My Duties' },
    { key: 'completed', label: 'Completed' },
    ...(canManage ? [
      { key: 'assign', label: 'Assign' },
      { key: 'areas', label: 'Areas' },
      { key: 'track', label: 'Track' },
    ] : []),
  ]

  const activeTab = ['assign', 'areas', 'track'].includes(tab) && !canManage ? 'mine' : tab

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading duties…</div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-9 h-9 rounded-2xl grad-tulasi flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <h2 className="text-lg font-bold text-primary-token">Cleanliness</h2>
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
                : 'bg-[var(--surface)] text-secondary-token border border-[var(--border-color)] hover:border-slate-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'mine' && (
        <div className="space-y-3">
          {myDuties.length === 0 ? (
            <EmptyState icon={Sparkles} message="No cleaning duties assigned right now." />
          ) : (
            myDuties.map((a) => (
              <DutyCard key={a.id} assignment={a} busy={busyId === a.id} onRespond={respond} />
            ))
          )}
        </div>
      )}

      {activeTab === 'completed' && (
        <div className="space-y-3">
          {completed.length === 0 ? (
            <EmptyState icon={CheckCircle2} message="No completed duties yet." />
          ) : (
            completed.map((a) => (
              <DutyCard key={a.id} assignment={a} busy={busyId === a.id} onRespond={respond} />
            ))
          )}
        </div>
      )}

      {activeTab === 'assign' && canManage && (
        <AssignForm members={members} orgId={orgId} assignedBy={profile?.id} onCreated={load} />
      )}

      {activeTab === 'areas' && canManage && (
        <AreasManager orgId={orgId} canManage={canManage} />
      )}

      {activeTab === 'track' && canManage && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-primary-token">All cleaning duties ({allSorted.length})</p>
          {allSorted.length === 0 ? (
            <EmptyState icon={Sparkles} message="No cleaning duties assigned yet." />
          ) : (
            allSorted.map((a) => (
              <TrackCard
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
      )}
    </div>
  )
}
