import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, BookOpen, CalendarDays, Sparkles, HandHeart,
  StickyNote, History, Plus, Trash2, TrendingUp, CheckCircle2, Clock,
} from 'lucide-react'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, addDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import { fetchTrackerConfig } from '@/lib/trackerApi'
import {
  menteePeriodScore, fetchMenteeAssignments, fetchNotes, addNote, deleteNote,
  fetchFollowups, addFollowup, setFollowupStatus, deleteFollowup, menteeAssignmentHistory,
} from '@/lib/counsellorApi'
import TrackerSpreadsheet from '@/pages/trackers/TrackerSpreadsheet'
import WeeklySadhanaCard from '@/pages/trackers/WeeklySadhanaCard'

const REPORTS = [
  { key: 'sadhana',      label: 'Sadhana',       icon: BookOpen },
  { key: 'card',         label: 'Weekly Card',   icon: CalendarDays },
  { key: 'trends',       label: 'Trends',        icon: TrendingUp },
  { key: 'cleanliness',  label: 'Cleanliness',   icon: Sparkles },
  { key: 'seva',         label: 'Seva',          icon: HandHeart },
  { key: 'notes',        label: 'Notes',         icon: StickyNote },
  { key: 'history',      label: 'History',       icon: History },
]

function scoreTone(pct) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 80) return 'text-tulasi-600'
  if (pct >= 60) return 'text-saffron-500'
  if (pct >= 40) return 'text-yellow-600'
  return 'text-red-500'
}

function AssignmentTaskList({ userId, moduleKey, label }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchMenteeAssignments({ userId, moduleKey }).then((data) => { if (active) setRows(data) }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [userId, moduleKey])

  const recent = rows.slice(0, 21)
  const completed = recent.filter((r) => ['completed', 'verified'].includes(r.status)).length
  const totalMinutes = recent.reduce((s, r) => s + (r.duration_min ?? 0), 0)

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading {label}…</div>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Card><CardBody className="py-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Completed (last 21)</p>
          <p className="text-xl font-extrabold text-slate-800 mt-1">{completed} / {recent.length}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Total Duration</p>
          <p className="text-xl font-extrabold text-slate-800 mt-1">{totalMinutes ? `${(totalMinutes / 60).toFixed(1)} hrs` : '—'}</p>
        </CardBody></Card>
      </div>
      {rows.length === 0 ? (
        <Card><CardBody className="py-8 text-center text-slate-400 text-sm">No {label.toLowerCase()} records yet.</CardBody></Card>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 30).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50">
              <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                ['completed', 'verified'].includes(r.status) ? 'bg-tulasi-500' :
                r.status === 'cancelled' ? 'bg-slate-300' : 'bg-yellow-400')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700 truncate">{r.title}</p>
                <p className="text-[11px] text-slate-400">{format(new Date(r.task_date), 'd MMM yyyy')}{r.area_name ? ` · ${r.area_name}` : ''}</p>
              </div>
              <Badge variant={['completed', 'verified'].includes(r.status) ? 'tulasi' : 'default'} className="text-[10px] capitalize">{r.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NotesTab({ mentee, orgId, canManage }) {
  const { profile } = useAuthStore()
  const toast = useToastStore()
  const [notes, setNotes] = useState([])
  const [followups, setFollowups] = useState([])
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [n, f] = await Promise.all([fetchNotes(mentee.id), fetchFollowups(mentee.id)])
      setNotes(n); setFollowups(f)
    } finally { setLoading(false) }
  }, [mentee.id])

  useEffect(() => { load() }, [load])

  const submitNote = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      await addNote(mentee.id, orgId, profile.id, body.trim())
      setBody('')
      await load()
    } catch (err) { toast.error('Could not add note', err.message) }
  }

  const submitFollowup = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await addFollowup(mentee.id, orgId, profile.id, title.trim(), due || null)
      setTitle(''); setDue('')
      await load()
    } catch (err) { toast.error('Could not add follow-up', err.message) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Follow-ups</p>
        <form onSubmit={submitFollowup} className="flex gap-2 mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Discuss regular Japa timing"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm" />
          <Button size="sm" icon={Plus} type="submit">Add</Button>
        </form>
        <div className="space-y-1.5">
          {followups.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50">
              <button onClick={() => setFollowupStatus(f.id, f.status === 'pending' ? 'completed' : 'pending').then(load)}>
                <CheckCircle2 className={cn('w-4 h-4', f.status === 'completed' ? 'text-tulasi-500' : 'text-slate-300')} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', f.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-700')}>{f.title}</p>
                {f.due_date && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Due {format(new Date(f.due_date), 'd MMM')}</p>}
              </div>
              <button onClick={() => deleteFollowup(f.id).then(load)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {followups.length === 0 && <p className="text-sm text-slate-400">No follow-ups yet.</p>}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Private Counsellor Notes</p>
        <form onSubmit={submitNote} className="flex gap-2 mb-3">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Add a private note…"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300" />
          <Button size="sm" icon={Plus} type="submit" className="self-end">Add</Button>
        </form>
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="px-3 py-2.5 rounded-xl bg-slate-50">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.body}</p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[11px] text-slate-400">
                  {n.author?.display_name ?? n.author?.spiritual_name ?? 'Counsellor'} · {format(new Date(n.created_at), 'd MMM yyyy, HH:mm')}
                </p>
                {(n.author_id === profile.id || canManage) && (
                  <button onClick={() => deleteNote(n.id).then(load)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
          ))}
          {notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
        </div>
      </div>
    </div>
  )
}

function TrendsTab({ mentee, tracker, fields, groups, rules, calculatedColumns }) {
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tracker?.id) return
    let active = true
    setLoading(true)
    const load = async () => {
      const anchors = Array.from({ length: 8 }, (_, i) => startOfWeek(subWeeks(new Date(), 7 - i), { weekStartsOn: 1 }))
      const results = await Promise.all(anchors.map(async (start) => {
        const end = addDays(start, 6)
        const weekly = await menteePeriodScore({
          trackerId: tracker.id, userId: mentee.id, startDate: start, endDate: end,
          fields, groups, rules, calculatedColumns,
        })
        return { start, pct: weekly.pct }
      }))
      if (active) setWeeks(results)
    }
    load().finally(() => active && setLoading(false))
    return () => { active = false }
  }, [tracker?.id, mentee.id, fields, groups, rules, calculatedColumns])

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading trend…</div>

  const max = Math.max(10, ...weeks.map((w) => w.pct ?? 0))

  return (
    <Card>
      <CardBody className="space-y-3">
        <p className="text-sm font-bold text-slate-700">Sadhana — Last 8 Weeks</p>
        <div className="flex items-end gap-2 h-40">
          {weeks.map((w) => (
            <div key={w.start.toISOString()} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn('w-full rounded-t-lg', w.pct == null ? 'bg-slate-100' : w.pct >= 80 ? 'bg-tulasi-400' : w.pct >= 60 ? 'bg-saffron-400' : w.pct >= 40 ? 'bg-yellow-400' : 'bg-red-400')}
                  style={{ height: `${w.pct != null ? Math.max(4, (w.pct / max) * 100) : 4}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400">{format(w.start, 'd MMM')}</p>
              <p className={cn('text-[11px] font-bold', scoreTone(w.pct))}>{w.pct != null ? `${w.pct.toFixed(0)}%` : '—'}</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function HistoryTab({ mentee }) {
  const [rows, setRows] = useState([])
  useEffect(() => { menteeAssignmentHistory(mentee.id).then(setRows) }, [mentee.id])
  return (
    <div className="space-y-2">
      {rows.map((h) => (
        <div key={h.id} className="px-3 py-2.5 rounded-xl bg-slate-50">
          <p className="text-sm font-semibold text-slate-700">{h.mentor_name}{h.status === 'active' && <Badge variant="tulasi" className="ml-2 text-[10px]">current</Badge>}</p>
          <p className="text-xs text-slate-400">
            {format(new Date(h.started_at), 'd MMM yyyy')} – {h.ended_at ? format(new Date(h.ended_at), 'd MMM yyyy') : 'present'}
          </p>
          {h.assigned_by_name && <p className="text-[11px] text-slate-400">Assigned by {h.assigned_by_name}</p>}
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-400">No history yet.</p>}
    </div>
  )
}

export default function CounselliProfile() {
  const { menteeId } = useParams()
  const navigate = useNavigate()
  const { org, hasPermission } = useOrgStore()
  const toast = useToastStore()
  const [mentee, setMentee] = useState(null)
  const [tab, setTab] = useState('sadhana')
  const [loading, setLoading] = useState(true)
  const [tracker, setTracker] = useState(null)
  const [config, setConfig] = useState({ fields: [], groups: [], rules: [], calculatedColumns: [] })
  const [weekScore, setWeekScore] = useState(null)
  const [monthScore, setMonthScore] = useState(null)
  const [sadhanaView, setSadhanaView] = useState('week')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: p, error } = await supabase
        .from('profiles')
        .select('id, display_name, spiritual_name, legal_name, avatar_url, phone')
        .eq('id', menteeId)
        .maybeSingle()
      if (error) throw error
      setMentee(p)

      const { data: t } = await supabase.from('tracker_definitions').select('id, name').eq('name', 'Sadhana').maybeSingle()
      setTracker(t ?? null)
      if (t?.id) {
        const cfg = await fetchTrackerConfig(t.id)
        setConfig({ fields: cfg.fields, groups: cfg.groups, rules: cfg.rules, calculatedColumns: cfg.calculated_columns })

        const now = new Date()
        const wStart = startOfWeek(now, { weekStartsOn: 1 }), wEnd = endOfWeek(now, { weekStartsOn: 1 })
        const mStart = startOfMonth(now), mEnd = endOfMonth(now)
        const [w, m] = await Promise.all([
          menteePeriodScore({ trackerId: t.id, userId: menteeId, startDate: wStart, endDate: wEnd, fields: cfg.fields, groups: cfg.groups, rules: cfg.rules, calculatedColumns: cfg.calculated_columns }),
          menteePeriodScore({ trackerId: t.id, userId: menteeId, startDate: mStart, endDate: mEnd, fields: cfg.fields, groups: cfg.groups, rules: cfg.rules, calculatedColumns: cfg.calculated_columns }),
        ])
        setWeekScore(w); setMonthScore(m)
      }
    } catch (e) {
      toast.error('Could not load counselli', e.message)
    } finally {
      setLoading(false)
    }
  }, [menteeId, toast])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-center text-slate-400">Loading profile…</div>
  if (!mentee) return <div className="p-8 text-center text-slate-400">Member not found, or you no longer have access.</div>

  const name = mentee.display_name ?? mentee.spiritual_name ?? mentee.legal_name

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Avatar name={name} url={mentee.avatar_url} size="lg" />
        <div>
          <h1 className="text-lg font-bold text-slate-800">{name}</h1>
          <p className="text-xs text-slate-400">Counselli Profile</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardBody className="py-3 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase">This Week</p>
          <p className={cn('text-xl font-extrabold mt-1', scoreTone(weekScore?.pct))}>{weekScore?.pct != null ? `${weekScore.pct.toFixed(1)}%` : '—'}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase">This Month</p>
          <p className={cn('text-xl font-extrabold mt-1', scoreTone(monthScore?.pct))}>{monthScore?.pct != null ? `${monthScore.pct.toFixed(1)}%` : '—'}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Since</p>
          <p className="text-xs font-semibold text-slate-700 mt-2">Counsellor view</p>
        </CardBody></Card>
      </div>

      <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-2xl overflow-x-auto">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => setTab(r.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all',
              tab === r.key ? 'bg-white text-saffron-600 elev-1 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <r.icon className="w-3.5 h-3.5" /> {r.label}
          </button>
        ))}
      </div>

      {tab === 'sadhana' && (
        tracker?.id ? (
          <div className="space-y-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
              <button onClick={() => setSadhanaView('week')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', sadhanaView === 'week' ? 'bg-white shadow-sm text-saffron-600' : 'text-slate-500')}>Weekly</button>
              <button onClick={() => setSadhanaView('month')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', sadhanaView === 'month' ? 'bg-white shadow-sm text-saffron-600' : 'text-slate-500')}>Monthly</button>
            </div>
            <TrackerSpreadsheet
              tracker={tracker}
              fields={config.fields} groups={config.groups} rules={config.rules} calculatedColumns={config.calculatedColumns}
              orgId={org?.id} userId={mentee.id} readOnly
            />
          </div>
        ) : <Card><CardBody className="py-8 text-center text-slate-400 text-sm">No Sadhana tracker configured for this organization.</CardBody></Card>
      )}

      {tab === 'card' && (
        tracker?.id ? (
          <WeeklySadhanaCard
            tracker={tracker}
            fields={config.fields} groups={config.groups} rules={config.rules} calculatedColumns={config.calculatedColumns}
            userId={mentee.id} devoteeName={name}
          />
        ) : <Card><CardBody className="py-8 text-center text-slate-400 text-sm">No Sadhana tracker configured.</CardBody></Card>
      )}

      {tab === 'trends' && (
        tracker?.id
          ? <TrendsTab mentee={mentee} tracker={tracker} {...config} />
          : <Card><CardBody className="py-8 text-center text-slate-400 text-sm">No Sadhana tracker configured.</CardBody></Card>
      )}

      {tab === 'cleanliness' && <AssignmentTaskList userId={mentee.id} moduleKey="cleanliness" label="Cleanliness" />}
      {tab === 'seva' && <AssignmentTaskList userId={mentee.id} moduleKey="service" label="Seva" />}
      {tab === 'notes' && <NotesTab mentee={mentee} orgId={org?.id} canManage={hasPermission('mentorship.manage')} />}
      {tab === 'history' && <HistoryTab mentee={mentee} />}
    </div>
  )
}
