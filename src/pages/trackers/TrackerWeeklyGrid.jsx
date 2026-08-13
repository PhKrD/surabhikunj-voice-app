import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Save, Check, Minus } from 'lucide-react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, isAfter } from 'date-fns'
import { supabase } from '@/lib/supabase'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'

const CELL_BASE = 'px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

function toISO(d) {
  return format(d, 'yyyy-MM-dd')
}

function weekStartFor(date) {
  return startOfWeek(date, { weekStartsOn: 1 })
}

function isEmptyValue(v) {
  if (v === null || v === undefined) return true
  if (typeof v === 'boolean') return v === false
  return String(v).trim() === ''
}

function WeekCell({ field, value, onChange }) {
  if (field.field_type === 'boolean') {
    const on = value === true || value === 'true' || value === '1'
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className={cn(
          'w-8 h-7 rounded-lg flex items-center justify-center transition',
          on ? 'bg-tulasi-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
        )}
      >
        {on ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
      </button>
    )
  }

  if (field.field_type === 'time') {
    return (
      <input
        type="time"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn(CELL_BASE, 'w-28')}
      />
    )
  }

  if (field.field_type === 'number' || field.field_type === 'duration_min') {
    return (
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        min={field.min_value ?? undefined}
        max={field.max_value ?? undefined}
        className={cn(CELL_BASE, 'w-20')}
      />
    )
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? ''}
      className={cn(CELL_BASE, 'w-32')}
    />
  )
}

export default function TrackerWeeklyGrid({ tracker, fields = [], rules = [], orgId, userId, computeScore }) {
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const toastInfo = useToastStore((s) => s.info)
  const [anchor, setAnchor] = useState(() => weekStartFor(new Date()))
  const [grid, setGrid] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor])
  const weekEnd = days[6]
  const canGoNext = !isAfter(addWeeks(anchor, 1), weekStartFor(new Date()))

  const load = useCallback(async () => {
    if (!tracker?.id || !userId) return
    setLoading(true)
    try {
      const startISO = toISO(anchor)
      const endISO = toISO(addDays(anchor, 6))

      const { data: entries, error } = await supabase
        .from('tracker_entries')
        .select('id, period_date, score')
        .eq('tracker_id', tracker.id)
        .eq('user_id', userId)
        .gte('period_date', startISO)
        .lte('period_date', endISO)
      if (error) throw error

      const next = {}
      for (let i = 0; i < 7; i++) next[toISO(addDays(anchor, i))] = {}

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
        for (const e of entries ?? []) {
          next[e.period_date] = byEntry[e.id] ?? {}
        }
      }

      setGrid(next)
    } catch (e) {
      toastError('Could not load week', e.message)
    } finally {
      setLoading(false)
    }
  }, [tracker?.id, userId, anchor, fields, toastError])

  useEffect(() => { load() }, [load])

  const setCell = (dateISO, key, value) => {
    setGrid((prev) => ({ ...prev, [dateISO]: { ...(prev[dateISO] ?? {}), [key]: value } }))
  }

  const dayScores = useMemo(() => {
    const out = {}
    for (const d of days) {
      const iso = toISO(d)
      const values = grid[iso] ?? {}
      const hasAny = Object.values(values).some((v) => !isEmptyValue(v))
      out[iso] = hasAny ? computeScore?.(rules, values) ?? null : null
    }
    return out
  }, [days, grid, rules, computeScore])

  const summary = useMemo(() => {
    const scores = Object.values(dayScores)
      .map((s) => s?.score)
      .filter((s) => s != null)
    if (!scores.length) return { count: 0, total: 0, average: 0 }
    const total = scores.reduce((a, b) => a + b, 0)
    return { count: scores.length, total, average: Math.round(total / scores.length) }
  }, [dayScores])

  const handleSave = async () => {
    if (!orgId || !userId) return
    setSaving(true)
    try {
      const rows = []
      for (const d of days) {
        const iso = toISO(d)
        const values = grid[iso] ?? {}
        const hasAny = Object.values(values).some((v) => !isEmptyValue(v))
        if (!hasAny) continue
        const scored = dayScores[iso]
        rows.push({
          payload: {
            tracker_id: tracker.id,
            org_id: orgId,
            user_id: userId,
            period_date: iso,
            score: scored?.score ?? null,
            score_detail: scored?.detail ?? {},
          },
          values,
        })
      }

      if (!rows.length) {
        toastInfo('Nothing to save', 'Fill in at least one value for this week.')
        return
      }

      const { data: saved, error } = await supabase
        .from('tracker_entries')
        .upsert(rows.map((r) => r.payload), { onConflict: 'tracker_id,user_id,period_date' })
        .select('id, period_date')
      if (error) throw error

      const idByDate = {}
      for (const s of saved ?? []) idByDate[s.period_date] = s.id

      const valueRows = []
      for (const r of rows) {
        const entryId = idByDate[r.payload.period_date]
        if (!entryId) continue
        for (const [field_key, val] of Object.entries(r.values)) {
          valueRows.push({ entry_id: entryId, field_key, value_text: String(val ?? '') })
        }
      }

      if (valueRows.length) {
        const { error: valErr } = await supabase
          .from('tracker_field_values')
          .upsert(valueRows, { onConflict: 'entry_id,field_key' })
        if (valErr) throw valErr
      }

      toastSuccess('Week saved', `${rows.length} ${rows.length === 1 ? 'day' : 'days'} updated`)
      await load()
    } catch (e) {
      toastError('Could not save week', e.message)
    } finally {
      setSaving(false)
    }
  }

  const rangeLabel = `${format(anchor, 'dd MMM')} – ${format(weekEnd, 'dd MMM yyyy')}`

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="py-3 flex items-center gap-3">
          <button
            onClick={() => setAnchor((a) => subWeeks(a, 1))}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Week of</p>
            <p className="font-semibold text-slate-800">{rangeLabel}</p>
          </div>
          <button
            onClick={() => canGoNext && setAnchor((a) => addWeeks(a, 1))}
            disabled={!canGoNext}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Week at a glance</span>
            {summary.count > 0 && (
              <Badge variant={summary.average >= 70 ? 'tulasi' : summary.average >= 40 ? 'saffron' : 'default'}>
                Avg {summary.average}/100
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading week…</div>
          ) : fields.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No fields configured for this tracker.</div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">Day</th>
                    {fields.map((f) => (
                      <th key={f.id ?? f.key} className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">
                        {f.label}
                        {f.unit && <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case">({f.unit})</span>}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const iso = toISO(d)
                    const isToday = isSameDay(d, new Date())
                    const scored = dayScores[iso]
                    return (
                      <tr key={iso} className={cn('border-b border-slate-50 last:border-0', isToday && 'bg-saffron-50/50')}>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <div className="font-semibold text-slate-700 text-xs">{format(d, 'EEE')}</div>
                          <div className="text-[10px] text-slate-400">{format(d, 'dd MMM')}</div>
                        </td>
                        {fields.map((f) => (
                          <td key={f.id ?? f.key} className="py-2 px-2">
                            <WeekCell
                              field={f}
                              value={(grid[iso] ?? {})[f.key]}
                              onChange={(v) => setCell(iso, f.key, v)}
                            />
                          </td>
                        ))}
                        <td className="py-2 px-2 text-right">
                          <span className="inline-block px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                            {scored?.score != null ? scored.score : '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} loading={saving} disabled={loading} icon={Save}>
              Save Week
            </Button>
            <p className="text-xs text-slate-400">
              {summary.count > 0
                ? `${summary.count} ${summary.count === 1 ? 'day' : 'days'} scored • total ${summary.total} • average ${summary.average}/100`
                : 'No scored days yet this week.'}
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
