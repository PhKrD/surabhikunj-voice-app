import { useState, useEffect, useCallback } from 'react'
import { ListChecks, Plus, ChevronLeft, ChevronRight, CheckCircle2, MinusCircle, XCircle, AlertCircle } from 'lucide-react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Can from '@/components/Can'
import { useTerm } from '@/hooks/usePermission'
import { cn } from '@/lib/utils'

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: 'bg-slate-100 text-slate-600',    icon: null },
  done:     { label: 'Done',     color: 'bg-green-100 text-green-700',    icon: CheckCircle2 },
  partial:  { label: 'Partial',  color: 'bg-yellow-100 text-yellow-700',  icon: MinusCircle },
  missed:   { label: 'Missed',   color: 'bg-red-100 text-red-600',        icon: XCircle },
  excused:  { label: 'Excused',  color: 'bg-blue-100 text-blue-700',      icon: AlertCircle },
  verified: { label: 'Verified', color: 'bg-purple-100 text-purple-700',  icon: CheckCircle2 },
}

const QUICK_STATUSES = ['done', 'partial', 'missed', 'excused']

export default function TasksPage() {
  const { profile } = useAuthStore()
  const { org } = useOrgStore()
  const toast = useToastStore()
  const orgId = org?.id ?? profile?.org_id
  const label = useTerm('tasks', 'Tasks')

  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [assignments, setAssignments] = useState([])
  const [logs, setLogs]               = useState({})  // { [assignmentId]: { status, notes } }
  const [expanded, setExpanded]       = useState(null) // id of card showing notes input
  const [notesDraft, setNotesDraft]   = useState('')
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState({})

  const load = useCallback(async () => {
    if (!profile || !orgId) return
    setLoading(true)
    const { data: asgn } = await supabase
      .from('task_assignments')
      .select('id, task_date, task_time, notes, task_templates(name, description, task_categories(name))')
      .eq('user_id', profile.id)
      .eq('task_date', date)
      .order('task_time')

    const ids = asgn?.map((a) => a.id) ?? []
    const logMap = {}
    if (ids.length) {
      const { data: logData } = await supabase
        .from('task_logs')
        .select('assignment_id, status, notes')
        .in('assignment_id', ids)
        .eq('log_date', date)
      logData?.forEach((l) => { logMap[l.assignment_id] = { status: l.status, notes: l.notes } })
    }

    setAssignments(asgn ?? [])
    setLogs(logMap)
    setLoading(false)
  }, [profile, orgId, date])

  useEffect(() => { load() }, [load])

  const markStatus = async (assignmentId, status, notes = '') => {
    setSaving((s) => ({ ...s, [assignmentId]: true }))
    try {
      const { error } = await supabase.from('task_logs').upsert({
        assignment_id: assignmentId,
        user_id:       profile.id,
        org_id:        orgId,
        log_date:      date,
        status,
        notes:         notes.trim() || null,
      }, { onConflict: 'assignment_id,log_date' })
      if (error) throw error
      setLogs((l) => ({ ...l, [assignmentId]: { status, notes } }))
      setExpanded(null)
    } catch (e) {
      toast.error('Could not save', e.message)
    } finally {
      setSaving((s) => ({ ...s, [assignmentId]: false }))
    }
  }

  const isToday = date === new Date().toISOString().split('T')[0]

  if (loading) return <div className="p-8 text-center text-slate-400">Loading {label}…</div>

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">{label}</h1>
        <Can permission="tasks.assign">
          <Button size="sm" icon={Plus}>Assign</Button>
        </Can>
      </div>

      {/* Date navigator */}
      <div className="flex items-center justify-between bg-white border border-slate-100 rounded-2xl px-4 py-2.5 shadow-sm">
        <button
          onClick={() => setDate(subDays(parseISO(date), 1).toISOString().split('T')[0])}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-slate-700">
          {isToday ? 'Today' : format(parseISO(date), 'EEEE, dd MMM')}
        </span>
        <button
          onClick={() => setDate(addDays(parseISO(date), 1).toISOString().split('T')[0])}
          disabled={isToday}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {assignments.length === 0 && (
        <Card>
          <CardBody className="py-12 text-center text-slate-400">
            <ListChecks className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No tasks assigned for this day.</p>
          </CardBody>
        </Card>
      )}

      <div className="space-y-3">
        {assignments.map((a) => {
          const log     = logs[a.id]
          const status  = log?.status ?? 'pending'
          const cfg     = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
          const isBusy  = saving[a.id]
          const isOpen  = expanded === a.id
          const StatusIcon = cfg.icon

          return (
            <Card key={a.id}>
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">
                        {a.task_templates?.name ?? 'Task'}
                      </p>
                      {a.task_templates?.task_categories?.name && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          {a.task_templates.task_categories.name}
                        </span>
                      )}
                    </div>
                    {a.task_time && (
                      <p className="text-xs text-slate-400 mt-0.5">{a.task_time}</p>
                    )}
                    {log?.notes && (
                      <p className="text-xs text-slate-500 italic mt-1">{log.notes}</p>
                    )}
                  </div>
                  <span className={cn('flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0', cfg.color)}>
                    {StatusIcon && <StatusIcon className="w-3.5 h-3.5" />}
                    {cfg.label}
                  </span>
                </div>

                {/* Quick status buttons — shown if not verified */}
                {status !== 'verified' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {QUICK_STATUSES.map((s) => (
                      <button
                        key={s}
                        disabled={isBusy || status === s}
                        onClick={() => {
                          if (s === 'done') { markStatus(a.id, s); return }
                          setExpanded(isOpen && expanded === a.id ? null : a.id)
                          setNotesDraft(log?.notes ?? '')
                        }}
                        className={cn(
                          'text-xs font-medium px-3 py-1.5 rounded-xl border transition-all disabled:opacity-50',
                          status === s
                            ? 'bg-slate-100 text-slate-400 border-slate-100 cursor-default'
                            : STATUS_CONFIG[s].color + ' border-transparent hover:opacity-80'
                        )}
                      >
                        {STATUS_CONFIG[s].label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Notes drawer for non-done statuses */}
                {isOpen && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      rows={2}
                      placeholder="Optional notes…"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 resize-none"
                    />
                    <div className="flex gap-2">
                      {['partial', 'missed', 'excused'].map((s) => (
                        <Button
                          key={s}
                          size="xs"
                          loading={isBusy}
                          onClick={() => markStatus(a.id, s, notesDraft)}
                        >
                          {STATUS_CONFIG[s].label}
                        </Button>
                      ))}
                      <button onClick={() => setExpanded(null)} className="text-xs text-slate-400 px-2">Cancel</button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
