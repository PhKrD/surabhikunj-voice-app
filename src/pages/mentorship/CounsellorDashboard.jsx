import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Search, AlertTriangle, ChevronRight } from 'lucide-react'
import { startOfWeek, addDays, differenceInCalendarDays, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { fetchTrackerConfig } from '@/lib/trackerApi'
import { myMentees, menteePeriodScore, fetchEntriesByDate } from '@/lib/counsellorApi'

function scoreTone(pct) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 80) return 'text-tulasi-600'
  if (pct >= 60) return 'text-saffron-500'
  if (pct >= 40) return 'text-yellow-600'
  return 'text-red-500'
}

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'score_desc', label: 'Highest Sadhana' },
  { key: 'score_asc', label: 'Lowest Sadhana' },
  { key: 'activity', label: 'Most Recent Activity' },
]

export default function CounsellorDashboard() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [mentees, setMentees] = useState([]) // [{ id, display_name, avatar_url, weekPct, lastActivity, needsAttention, reason }]
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name')
  const [onlyAttention, setOnlyAttention] = useState(false)

  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    try {
      const rels = await myMentees()
      const ids = rels.map((r) => r.mentee_id)
      if (!ids.length) { setMentees([]); setLoading(false); return }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, spiritual_name, legal_name, avatar_url')
        .in('id', ids)

      const { data: tracker } = await supabase
        .from('tracker_definitions')
        .select('id')
        .eq('name', 'Sadhana')
        .maybeSingle()

      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
      const weekEnd = addDays(weekStart, 6)

      let fields = [], groups = [], rules = [], calculatedColumns = []
      if (tracker?.id) {
        const cfg = await fetchTrackerConfig(tracker.id)
        fields = cfg.fields; groups = cfg.groups; rules = cfg.rules; calculatedColumns = cfg.calculated_columns
      }

      const rows = await Promise.all((profiles ?? []).map(async (p) => {
        const name = p.display_name ?? p.spiritual_name ?? p.legal_name ?? 'Member'
        if (!tracker?.id) return { ...p, name, weekPct: null, lastActivity: null, needsAttention: false, reason: null }
        try {
          const entriesByDate = await fetchEntriesByDate({
            trackerId: tracker.id, userId: p.id, startDate: weekStart, endDate: weekEnd, fields,
          })
          const dates = Object.keys(entriesByDate).filter((d) => Object.keys(entriesByDate[d] ?? {}).length > 0)
          const lastActivity = dates.length ? dates.sort().at(-1) : null
          const weekly = await menteePeriodScore({
            trackerId: tracker.id, userId: p.id, startDate: weekStart, endDate: weekEnd,
            fields, groups, rules, calculatedColumns,
          })
          const daysSince = lastActivity ? differenceInCalendarDays(new Date(), new Date(lastActivity)) : null
          let needsAttention = false, reason = null
          if (daysSince == null) { needsAttention = true; reason = 'No Sadhana submitted this week' }
          else if (daysSince >= 2) { needsAttention = true; reason = `No activity for ${daysSince} days` }
          else if (weekly.pct != null && weekly.pct < 50) { needsAttention = true; reason = 'Sadhana below target' }
          return { ...p, name, weekPct: weekly.pct, lastActivity, needsAttention, reason }
        } catch {
          return { ...p, name, weekPct: null, lastActivity: null, needsAttention: false, reason: null }
        }
      }))
      setMentees(rows)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let rows = mentees
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter((m) => m.name.toLowerCase().includes(q))
    if (onlyAttention) rows = rows.filter((m) => m.needsAttention)
    rows = [...rows]
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'score_desc') rows.sort((a, b) => (b.weekPct ?? -1) - (a.weekPct ?? -1))
    if (sort === 'score_asc') rows.sort((a, b) => (a.weekPct ?? 999) - (b.weekPct ?? 999))
    if (sort === 'activity') rows.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
    return rows
  }, [mentees, search, sort, onlyAttention])

  const stats = useMemo(() => {
    const total = mentees.length
    const attention = mentees.filter((m) => m.needsAttention).length
    const scored = mentees.filter((m) => m.weekPct != null)
    const avg = scored.length ? scored.reduce((s, m) => s + m.weekPct, 0) / scored.length : null
    const submitted = mentees.filter((m) => m.lastActivity).length
    return { total, attention, avg, submitted }
  }, [mentees])

  if (loading) return <div className="p-8 text-center text-slate-400">Loading dashboard…</div>

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">Counsellor Dashboard</h1>
        <p className="text-sm text-slate-500">Welcome, {profile?.display_name ?? profile?.spiritual_name}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardBody className="py-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">My Counsellis</p>
          <p className="text-2xl font-extrabold text-slate-800 mt-1">{stats.total}</p>
        </CardBody></Card>
        <Card><CardBody className="py-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Sadhana Avg</p>
          <p className={cn('text-2xl font-extrabold mt-1', scoreTone(stats.avg))}>{stats.avg != null ? `${stats.avg.toFixed(1)}%` : '—'}</p>
        </CardBody></Card>
        <Card><CardBody className="py-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Submitted</p>
          <p className="text-2xl font-extrabold text-slate-800 mt-1">{stats.submitted} / {stats.total}</p>
        </CardBody></Card>
        <Card><CardBody className="py-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Needs Attention</p>
          <p className={cn('text-2xl font-extrabold mt-1', stats.attention ? 'text-red-500' : 'text-slate-800')}>{stats.attention}</p>
        </CardBody></Card>
      </div>

      {stats.attention > 0 && (
        <Card className="!border-red-100">
          <CardBody className="space-y-2">
            <p className="text-sm font-bold text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Needs Attention</p>
            {mentees.filter((m) => m.needsAttention).map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`counselli/${m.id}`)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-red-50 text-left"
              >
                <Avatar name={m.name} url={m.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                  <p className="text-xs text-red-500">{m.reason}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </button>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search counsellis…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300 bg-white"
          />
        </div>
        <button
          onClick={() => setOnlyAttention((v) => !v)}
          className={cn('px-3 py-2.5 rounded-xl text-xs font-semibold border whitespace-nowrap', onlyAttention ? 'bg-red-500 text-white border-red-500' : 'bg-white text-slate-500 border-slate-200')}
        >
          Needs Attention
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><CardBody className="py-10 text-center text-slate-400">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No counsellis {onlyAttention ? 'need attention right now' : 'assigned yet'}.</p>
          </CardBody></Card>
        )}
        {filtered.map((m) => (
          <Card key={m.id}>
            <CardBody className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`counselli/${m.id}`)}>
              <Avatar name={m.name} url={m.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800 truncate">{m.name}</p>
                <p className="text-xs text-slate-400">
                  {m.lastActivity ? `Last activity ${format(new Date(m.lastActivity), 'd MMM')}` : 'No activity yet'}
                </p>
              </div>
              {m.needsAttention && <Badge variant="danger" className="text-[10px]">Needs Attention</Badge>}
              <div className="text-right">
                <p className={cn('font-bold text-sm', scoreTone(m.weekPct))}>{m.weekPct != null ? `${m.weekPct.toFixed(0)}%` : '—'}</p>
                <p className="text-[10px] text-slate-400">this week</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
