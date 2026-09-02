import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, BookOpen, ListChecks } from 'lucide-react'
import { format, subDays, parseISO, eachDayOfInterval } from 'date-fns'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Can from '@/components/Can'
import { cn } from '@/lib/utils'

// ── Inline SVG bar chart ──────────────────────────────────────────────────────
function MiniBarChart({ data, color = '#f97316', height = 80 }) {
  if (!data?.length) return null
  const max = Math.max(...data.map((d) => d.value ?? 0), 1)
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((d, i) => {
        const pct = max > 0 ? ((d.value ?? 0) / max) * 100 : 0
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{ height: '100%' }}>
            <div
              className="w-full rounded-t-sm transition-all"
              style={{ height: `${Math.max(pct, 2)}%`, backgroundColor: d.value ? color : '#e2e8f0' }}
            />
            {d.label && (
              <span className="absolute -bottom-4 text-[9px] text-muted-token w-full text-center truncate">
                {d.label}
              </span>
            )}
            <div className="absolute bottom-full mb-1 hidden group-hover:flex bg-slate-800 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {d.tooltip ?? d.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, sub, color = 'text-saffron-600' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('text-2xl font-extrabold', color)}>{value}</span>
      <span className="text-xs font-medium text-secondary-token">{label}</span>
      {sub && <span className="text-xs text-muted-token">{sub}</span>}
    </div>
  )
}

// ── Personal tracker trend section ───────────────────────────────────────────
function TrackerTrendSection({ profile, orgId }) {
  const [trackers, setTrackers] = useState([])
  const [selected, setSelected] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('tracker_definitions')
      .select('id, name, color, has_scoring')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setTrackers(data ?? [])
        if (data?.length) setSelected(data[0].id)
      })
  }, [orgId])

  useEffect(() => {
    if (!selected || !profile) return
    setLoading(true)
    supabase.rpc('my_tracker_entries', { p_tracker_id: selected, p_limit: 30 })
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
  }, [selected, profile])

  const days = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() })
  const entryMap = Object.fromEntries(entries.map((e) => [e.period_date, e]))

  const chartData = days.map((d) => {
    const key = format(d, 'yyyy-MM-dd')
    const entry = entryMap[key]
    return {
      value: entry?.score ?? (entry ? 1 : 0),
      label: format(d, 'd'),
      tooltip: entry ? `${format(d, 'dd MMM')}: ${entry.score?.toFixed(1) ?? '✓'}` : format(d, 'dd MMM'),
    }
  })

  const tracker = trackers.find((t) => t.id === selected)
  const submitted = entries.length
  const avgScore = entries.filter((e) => e.score != null).length
    ? (entries.reduce((s, e) => s + (e.score ?? 0), 0) / entries.filter((e) => e.score != null).length).toFixed(1)
    : '—'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-secondary-token" />
            <h3 className="font-semibold text-primary-token">Tracker — 30-day Trend</h3>
          </div>
          {trackers.length > 1 && (
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              className="text-sm border border-[var(--border-color)] rounded-lg px-2 py-1 text-primary-token focus:outline-none"
            >
              {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex gap-6 mb-4">
          <StatPill label="Entries (30d)" value={submitted} color="text-saffron-600" />
          {tracker?.has_scoring && <StatPill label="Avg Score" value={avgScore} color="text-lotus-600" />}
          <StatPill label="Streak" value={`${calcStreak(entries)}d`} sub="consecutive" color="text-tulasi-600" />
        </div>
        {loading
          ? <div className="h-20 bg-[var(--surface-muted)] rounded-xl animate-pulse" />
          : <div className="pb-5"><MiniBarChart data={chartData} color={tracker?.color ?? '#f97316'} height={80} /></div>
        }
      </CardBody>
    </Card>
  )
}

function calcStreak(entries) {
  if (!entries.length) return 0
  const sorted = [...entries].sort((a, b) => b.period_date.localeCompare(a.period_date))
  let streak = 0
  let cursor = new Date()
  for (const e of sorted) {
    const d = parseISO(e.period_date)
    const diff = Math.round((cursor - d) / 86400000)
    if (diff <= 1) { streak++; cursor = d } else break
  }
  return streak
}

// ── Task completion section ───────────────────────────────────────────────────
function TaskCompletionSection({ profile }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    const days = eachDayOfInterval({ start: subDays(new Date(), 13), end: new Date() })
    const from = format(subDays(new Date(), 13), 'yyyy-MM-dd')
    const to   = format(new Date(), 'yyyy-MM-dd')

    Promise.all([
      supabase.from('task_assignments').select('id, task_date').eq('user_id', profile.id).gte('task_date', from).lte('task_date', to),
      supabase.from('task_logs').select('assignment_id, log_date, status').eq('user_id', profile.id).gte('log_date', from).lte('log_date', to),
    ]).then(([aRes, lRes]) => {
      const assigns = aRes.data ?? []
      const logs    = lRes.data ?? []
      const logMap  = Object.fromEntries(logs.map((l) => [l.assignment_id + l.log_date, l.status]))

      const chart = days.map((d) => {
        const key = format(d, 'yyyy-MM-dd')
        const dayAssigns = assigns.filter((a) => a.task_date === key)
        const done = dayAssigns.filter((a) => ['done', 'verified'].includes(logMap[a.id + key] ?? '')).length
        const total = dayAssigns.length
        return {
          value: total > 0 ? Math.round((done / total) * 100) : 0,
          label: format(d, 'd'),
          tooltip: total ? `${format(d, 'dd MMM')}: ${done}/${total} done` : format(d, 'dd MMM'),
        }
      })
      setData(chart)
      setLoading(false)
    })
  }, [profile])

  const avg = data.filter((d) => d.value > 0).length
    ? Math.round(data.reduce((s, d) => s + d.value, 0) / data.filter((d) => d.value > 0).length)
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-secondary-token" />
          <h3 className="font-semibold text-primary-token">Task Completion — 14 Days</h3>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex gap-6 mb-4">
          <StatPill label="Avg Completion" value={`${avg}%`} color="text-saffron-600" />
          <StatPill label="Days with Tasks" value={data.filter((d) => d.value > 0).length} color="text-blue-600" />
        </div>
        {loading
          ? <div className="h-20 bg-[var(--surface-muted)] rounded-xl animate-pulse" />
          : <div className="pb-5"><MiniBarChart data={data} color="#6366f1" height={80} /></div>
        }
      </CardBody>
    </Card>
  )
}

// ── Org-wide admin section ────────────────────────────────────────────────────
function OrgStatsSection({ orgId }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const today = format(new Date(), 'yyyy-MM-dd')
    const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd')

    const [membersRes, entriesRes, logsRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
      supabase.from('tracker_entries').select('user_id', { count: 'exact', head: false })
        .eq('org_id', orgId).gte('period_date', weekAgo).lte('period_date', today),
      supabase.from('task_logs').select('status', { count: 'exact', head: false })
        .eq('org_id', orgId).gte('log_date', weekAgo).lte('log_date', today),
    ])

    const members   = membersRes.count ?? 0
    const submitters = new Set((entriesRes.data ?? []).map((e) => e.user_id)).size
    const logs      = logsRes.data ?? []
    const done      = logs.filter((l) => l.status === 'done' || l.status === 'verified').length

    setStats({ members, submitters, totalLogs: logs.length, done })
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="h-28 bg-[var(--surface-muted)] rounded-2xl animate-pulse" />

  const pct = stats.members ? Math.round((stats.submitters / stats.members) * 100) : 0
  const taskPct = stats.totalLogs ? Math.round((stats.done / stats.totalLogs) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-secondary-token" />
          <h3 className="font-semibold text-primary-token">Org Overview — Last 7 Days</h3>
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <StatPill label="Active Members" value={stats.members} color="text-primary-token" />
          <StatPill label="Tracker Submissions" value={stats.submitters} sub={`${pct}% of members`} color="text-lotus-600" />
          <StatPill label="Task Logs" value={stats.totalLogs} color="text-saffron-600" />
          <StatPill label="Completion Rate" value={`${taskPct}%`} sub={`${stats.done} done`} color="text-tulasi-600" />
        </div>
        {/* Progress bars */}
        <div className="mt-5 space-y-3">
          <div>
            <div className="flex justify-between text-xs text-secondary-token mb-1">
              <span>Tracker participation</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-muted)] overflow-hidden">
              <div className="h-full rounded-full bg-lotus-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-secondary-token mb-1">
              <span>Task completion</span>
              <span>{taskPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-muted)] overflow-hidden">
              <div className="h-full rounded-full bg-tulasi-400 transition-all" style={{ width: `${taskPct}%` }} />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { profile } = useAuthStore()
  const { org, hasAnyPermission } = useOrgStore()
  // The org section aggregates every member's entries and logs, so gate it on
  // the permissions that actually authorise reading them.
  const canViewOrg = hasAnyPermission(['trackers.view_all', 'tasks.view_all'])

  if (!profile) return null

  return (
    <Can permission="reports.view" fallback={<Navigate to="/" replace />}>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-saffron-500" />
          <h1 className="text-2xl font-extrabold text-primary-token">Reports</h1>
        </div>

        <TrackerTrendSection profile={profile} orgId={org?.id} />
        <TaskCompletionSection profile={profile} />

        {canViewOrg && org?.id && (
          <OrgStatsSection orgId={org.id} />
        )}
      </div>
    </Can>
  )
}
