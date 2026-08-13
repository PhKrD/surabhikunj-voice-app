import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Share2, Award, CalendarX2 } from 'lucide-react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isAfter, isBefore, startOfDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import { calculateEntryScore, aggregatePeriod, hasValue } from '@/lib/trackerScoring'
import WhatsAppShareModal from './WhatsAppShareModal'

function toISO(d) { return format(d, 'yyyy-MM-dd') }

function scoreTone(pct) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 80) return 'text-tulasi-600'
  if (pct >= 60) return 'text-saffron-500'
  if (pct >= 40) return 'text-yellow-600'
  return 'text-red-500'
}
function scoreBar(pct) {
  if (pct == null) return 'bg-slate-200'
  if (pct >= 80) return 'bg-gradient-to-r from-tulasi-400 to-emerald-500'
  if (pct >= 60) return 'bg-gradient-to-r from-saffron-400 to-orange-500'
  if (pct >= 40) return 'bg-gradient-to-r from-yellow-400 to-amber-500'
  return 'bg-gradient-to-r from-rose-400 to-red-500'
}

export default function WeeklySadhanaCard({ tracker, fields = [], groups = [], rules = [], calculatedColumns = [], userId, devoteeName }) {
  const toastError = useToastStore((s) => s.error)
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [entriesByDate, setEntriesByDate] = useState({})
  const [loading, setLoading] = useState(true)
  const [showShare, setShowShare] = useState(false)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor])
  const weekEnd = days[6]
  const isFinal = isBefore(weekEnd, startOfDay(new Date()))
  const canGoNext = !isAfter(addWeeks(anchor, 1), startOfWeek(new Date(), { weekStartsOn: 1 }))

  const load = useCallback(async () => {
    if (!tracker?.id || !userId) return
    setLoading(true)
    try {
      const startISO = toISO(days[0])
      const endISO = toISO(days[6])
      const { data: entries, error } = await supabase
        .from('tracker_entries')
        .select('id, period_date')
        .eq('tracker_id', tracker.id)
        .eq('user_id', userId)
        .gte('period_date', startISO)
        .lte('period_date', endISO)
      if (error) throw error

      const next = {}
      for (const d of days) next[toISO(d)] = {}

      const ids = (entries ?? []).map((e) => e.id)
      if (ids.length) {
        const { data: vals, error: valErr } = await supabase
          .from('tracker_field_values')
          .select('entry_id, field_key, value_text')
          .in('entry_id', ids)
        if (valErr) throw valErr
        const byEntry = {}
        for (const v of vals ?? []) {
          byEntry[v.entry_id] = byEntry[v.entry_id] ?? {}
          const f = fields.find((ff) => ff.key === v.field_key)
          byEntry[v.entry_id][v.field_key] = f?.field_type === 'boolean'
            ? (v.value_text === 'true' || v.value_text === '1')
            : v.value_text
        }
        for (const e of entries ?? []) next[e.period_date] = byEntry[e.id] ?? {}
      }
      setEntriesByDate(next)
    } catch (e) {
      toastError('Could not load weekly card', e.message)
    } finally {
      setLoading(false)
    }
  }, [tracker?.id, userId, days, fields, toastError])

  useEffect(() => { load() }, [load])

  const weekly = useMemo(() => aggregatePeriod({ rules, fields, groups, calculatedColumns, entriesByDate }), [rules, fields, groups, calculatedColumns, entriesByDate])

  const dailyScores = useMemo(() => days.map((d) => {
    const iso = toISO(d)
    const values = entriesByDate[iso] ?? {}
    const any = Object.values(values).some((v) => hasValue(v))
    const result = any ? calculateEntryScore({ rules, fields, groups, calculatedColumns, fieldValues: values }) : null
    return { date: d, iso, score: result?.score ?? null }
  }), [days, entriesByDate, rules, fields, groups, calculatedColumns])

  const bestDay = useMemo(() => {
    const withScores = dailyScores.filter((d) => d.score != null)
    if (!withScores.length) return null
    return withScores.reduce((a, b) => (b.score > a.score ? b : a))
  }, [dailyScores])

  const missedFields = useMemo(() => (
    fields.filter((f) => f.is_active !== false && weekly.fieldTotals[f.key] && (
      !Object.values(entriesByDate).some((v) => hasValue(v?.[f.key]))
    ))
  ), [fields, weekly, entriesByDate])

  const rangeLabel = `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM yyyy')}`

  const shareText = useMemo(() => {
    const lines = [
      'Hare Krishna Prabhuji,', '',
      `Weekly Sadhana Report`,
      rangeLabel, '',
      `Overall: ${weekly.pct != null ? weekly.pct.toFixed(1) : '0.0'}%`, '',
    ]
    for (const g of groups) {
      const t = weekly.groupTotals[g.key]
      if (t && t.max) lines.push(`${g.label}: ${((t.earned / t.max) * 100).toFixed(1)}%`)
    }
    lines.push('')
    for (const f of fields) {
      const t = weekly.fieldTotals[f.key]
      if (!t || !t.max) continue
      lines.push(`${f.label}: ${t.earned.toFixed(1)}/${t.max.toFixed(1)}`)
    }
    if (bestDay) lines.push('', `Best Day: ${format(bestDay.date, 'EEEE')} – ${bestDay.score}%`)
    lines.push('', 'ys', devoteeName ?? '')
    return lines.join('\n')
  }, [weekly, groups, fields, bestDay, rangeLabel, devoteeName])

  return (
    <div className="space-y-4">
      {/* Header / navigation */}
      <Card>
        <CardBody className="py-3 flex items-center gap-3">
          <button onClick={() => setAnchor((a) => subWeeks(a, 1))} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Weekly Sadhana Card</p>
            <p className="font-semibold text-slate-800 text-sm">{rangeLabel}</p>
          </div>
          <button
            onClick={() => canGoNext && setAnchor((a) => addWeeks(a, 1))}
            disabled={!canGoNext}
            className={cn('p-2 rounded-xl', canGoNext ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100' : 'text-slate-200 cursor-not-allowed')}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </CardBody>
      </Card>

      {loading ? (
        <div className="p-10 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          {/* Overall score hero */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-saffron-500 via-orange-500 to-amber-400 p-6">
            <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-bold text-white/70 uppercase tracking-widest">Overall Sadhana Score</p>
                  <Badge variant={isFinal ? 'tulasi' : 'default'} className="!bg-white/20 !text-white">
                    {isFinal ? 'FINAL' : 'In Progress'}
                  </Badge>
                </div>
                <p className="text-4xl font-extrabold text-white">{weekly.pct != null ? weekly.pct.toFixed(1) : '0.0'}%</p>
                <p className="text-sm text-white/70 mt-1">Earned {weekly.earned.toFixed(0)} / {weekly.max.toFixed(0)}</p>
              </div>
              <Button
                icon={Share2}
                onClick={() => setShowShare(true)}
                className="bg-white/20 hover:bg-white/30 text-white border border-white/30 shadow-none"
              >
                Share
              </Button>
            </div>
          </div>

          {/* Group breakdown (Body / Soul / custom) */}
          {groups.length > 0 && (
            <div className={cn('grid gap-3', groups.length === 2 ? 'grid-cols-2' : groups.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
              {groups.map((g) => {
                const t = weekly.groupTotals[g.key]
                const pct = t && t.max ? (t.earned / t.max) * 100 : null
                return (
                  <Card key={g.key}>
                    <CardBody className="text-center py-4">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{g.label}</p>
                      <p className={cn('text-2xl font-extrabold', scoreTone(pct))}>{pct != null ? pct.toFixed(1) : '—'}%</p>
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Daily breakdown */}
          <Card>
            <CardHeader><p className="text-sm font-bold text-slate-800">Daily Breakdown</p></CardHeader>
            <CardBody className="space-y-2">
              {dailyScores.map((d) => (
                <div key={d.iso} className="flex items-center gap-3">
                  <span className="w-20 text-xs font-medium text-slate-500">{format(d.date, 'EEEE')}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    {d.score != null && <div className={cn('h-full rounded-full', scoreBar(d.score))} style={{ width: `${d.score}%` }} />}
                  </div>
                  <span className={cn('w-12 text-right text-xs font-bold', scoreTone(d.score))}>{d.score != null ? `${d.score}%` : '—'}</span>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Activity performance */}
          <Card>
            <CardHeader><p className="text-sm font-bold text-slate-800">Activity Performance</p></CardHeader>
            <CardBody className="!pt-2">
              <div className="divide-y divide-slate-50">
                {fields.filter((f) => weekly.fieldTotals[f.key]?.max).map((f) => {
                  const t = weekly.fieldTotals[f.key]
                  const pct = t.max ? (t.earned / t.max) * 100 : null
                  return (
                    <div key={f.key} className="flex items-center justify-between py-2.5">
                      <span className="text-sm font-medium text-slate-700">{f.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{t.earned.toFixed(1)}/{t.max.toFixed(1)}</span>
                        <Badge variant={pct >= 70 ? 'tulasi' : pct >= 40 ? 'saffron' : 'red'}>{pct.toFixed(0)}%</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>

          {/* Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {bestDay && (
              <Card>
                <CardBody className="flex items-center gap-3 py-4">
                  <div className="w-10 h-10 rounded-2xl bg-tulasi-50 flex items-center justify-center flex-shrink-0">
                    <Award className="w-5 h-5 text-tulasi-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Best Day</p>
                    <p className="text-sm font-bold text-slate-800">{format(bestDay.date, 'EEEE')} · {bestDay.score}%</p>
                  </div>
                </CardBody>
              </Card>
            )}
            {missedFields.length > 0 && (
              <Card>
                <CardBody className="flex items-center gap-3 py-4">
                  <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center flex-shrink-0">
                    <CalendarX2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Missed this week</p>
                    <p className="text-sm font-bold text-slate-800">{missedFields.map((f) => f.label).join(', ')}</p>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {showShare && (
        <WhatsAppShareModal title="Weekly Sadhana Card" initialMessage={shareText} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}
