import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Check, Minus, Save } from 'lucide-react'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  startOfMonth, endOfMonth, addMonths, subMonths, eachDayOfInterval,
} from 'date-fns'
import { supabase } from '@/lib/supabase'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import {
  calculateFieldScore, hasValue, resolveGroupTotals, resolveCalculatedColumns,
} from '@/lib/trackerScoring'

const CELL_BASE = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'
const DATE_W = 60
const DAY_W = 44
const CALC_W = 68

function toISO(d) { return format(d, 'yyyy-MM-dd') }

function EditableCell({ field, value, onChange }) {
  if (field.field_type === 'boolean') {
    const on = value === true || value === 'true' || value === '1'
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className={cn(
          'w-full h-7 rounded-lg flex items-center justify-center transition',
          on ? 'bg-tulasi-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
        )}
      >
        {on ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
      </button>
    )
  }
  if (field.field_type === 'time') {
    return <input type="time" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={CELL_BASE} />
  }
  if (field.field_type === 'number' || field.field_type === 'duration_min') {
    return (
      <input
        type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        min={field.min_value ?? undefined} max={field.max_value ?? undefined} className={CELL_BASE}
      />
    )
  }
  if (field.field_type === 'select') {
    const opts = Array.isArray(field.options) ? field.options : []
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={CELL_BASE}>
        <option value="">–</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={CELL_BASE} />
}

// Which columns to render per field: raw input column, marks column, both, or neither.
function buildColumnPlan(fields, rulesByField) {
  return (fields ?? []).filter((f) => f.is_active !== false).map((f) => {
    const hasRule = (rulesByField[f.key]?.length ?? 0) > 0
    let showInput = f.show_input !== false
    let showMarks = f.show_marks !== false && hasRule
    if (!showInput && !showMarks) showInput = true // never fully hide a field
    return { field: f, showInput, showMarks, hasRule }
  })
}

function groupByField(rules) {
  const out = {}
  for (const r of rules ?? []) {
    if (!out[r.field_key]) out[r.field_key] = []
    out[r.field_key].push(r)
  }
  return out
}

function ReadOnlyCell({ field, value }) {
  if (field.field_type === 'boolean') {
    const on = value === true || value === 'true' || value === '1'
    return (
      <div className={cn('w-full h-7 rounded-lg flex items-center justify-center', on ? 'bg-tulasi-100 text-tulasi-600' : 'bg-slate-50 text-slate-300')}>
        {on ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
      </div>
    )
  }
  return <div className="px-2 py-1.5 text-xs text-slate-700 text-center truncate">{hasValue(value) ? String(value) : '–'}</div>
}

export default function TrackerSpreadsheet({ tracker, fields = [], groups = [], rules = [], calculatedColumns = [], orgId, userId, readOnly = false }) {
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)
  const toastInfo = useToastStore((s) => s.info)

  const [mode, setMode] = useState('week') // 'week' | 'month'
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [grid, setGrid] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const days = useMemo(() => {
    if (mode === 'week') return Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
    return eachDayOfInterval({ start: startOfMonth(anchor), end: endOfMonth(anchor) })
  }, [mode, anchor])

  const canGoNext = true

  const rulesByField = useMemo(() => groupByField(rules), [rules])
  const columnPlan = useMemo(() => buildColumnPlan(fields, rulesByField), [fields, rulesByField])

  // Ordered groups + an implicit "Other" bucket for ungrouped fields
  const orderedGroups = useMemo(() => {
    const active = [...groups].filter((g) => g.is_active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const grouped = active.map((g) => ({ group: g, columns: columnPlan.filter((c) => c.field.group_id === g.id) }))
    const ungroupedCols = columnPlan.filter((c) => !c.field.group_id || !active.some((g) => g.id === c.field.group_id))
    return ungroupedCols.length ? [...grouped, { group: null, columns: ungroupedCols }] : grouped
  }, [groups, columnPlan])

  const activeColumns = useMemo(() => orderedGroups.flatMap((g) => g.columns), [orderedGroups])
  const sortedColumns = useMemo(() => [...calculatedColumns].filter((c) => c.is_active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [calculatedColumns])

  const load = useCallback(async () => {
    if (!tracker?.id || !userId) return
    setLoading(true)
    try {
      const startISO = toISO(days[0])
      const endISO = toISO(days[days.length - 1])

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

      setGrid(next)
    } catch (e) {
      toastError('Could not load data', e.message)
    } finally {
      setLoading(false)
    }
  }, [tracker?.id, userId, days, fields, toastError])

  useEffect(() => { load() }, [load])

  const setCell = (dateISO, key, value) => {
    setGrid((prev) => ({ ...prev, [dateISO]: { ...(prev[dateISO] ?? {}), [key]: value } }))
  }

  // Per-day computed field totals, used for Marks columns + calculated columns
  const dayTotals = useMemo(() => {
    const out = {}
    for (const d of days) {
      const iso = toISO(d)
      const values = grid[iso] ?? {}
      const fieldTotals = {}
      for (const { field, hasRule } of columnPlan) {
        if (!hasRule) continue
        let earned = 0, max = 0
        for (const rule of rulesByField[field.key] ?? []) {
          max += Number(rule.max_points) || 0
          if (hasValue(values[field.key])) earned += calculateFieldScore(rule, values).points
        }
        fieldTotals[field.key] = { earned, max }
      }
      const groupTotals = resolveGroupTotals(groups, fields, fieldTotals)
      const columnTotals = resolveCalculatedColumns(sortedColumns, fieldTotals, groupTotals)
      out[iso] = { fieldTotals, groupTotals, columnTotals }
    }
    return out
  }, [days, grid, columnPlan, rulesByField, groups, fields, sortedColumns])

  // Footer summary: earned/max per Marks column + per calculated column
  const summary = useMemo(() => {
    const fieldSum = {}
    const columnSum = {}
    for (const d of days) {
      const t = dayTotals[toISO(d)]
      if (!t) continue
      for (const [key, v] of Object.entries(t.fieldTotals)) {
        fieldSum[key] = fieldSum[key] ?? { earned: 0, max: 0 }
        fieldSum[key].earned += v.earned
        fieldSum[key].max += v.max
      }
      for (const [key, v] of Object.entries(t.columnTotals)) {
        columnSum[key] = columnSum[key] ?? { earned: 0, max: 0 }
        columnSum[key].earned += v.earned
        columnSum[key].max += v.max
      }
    }
    return { fieldSum, columnSum }
  }, [days, dayTotals])

  const handleSave = async () => {
    if (!orgId || !userId) return
    setSaving(true)
    try {
      const rows = []
      for (const d of days) {
        const iso = toISO(d)
        const values = grid[iso] ?? {}
        const anyValue = Object.values(values).some((v) => hasValue(v))
        if (!anyValue) continue
        const t = dayTotals[iso]
        let earned = 0, max = 0
        for (const v of Object.values(t?.fieldTotals ?? {})) { earned += v.earned; max += v.max }
        rows.push({
          payload: {
            tracker_id: tracker.id, org_id: orgId, user_id: userId, period_date: iso,
            score: max > 0 ? Math.round((earned / max) * 100) : null,
            score_detail: t ?? {},
          },
          values,
        })
      }
      if (!rows.length) {
        toastInfo('Nothing to save', 'Fill in at least one value first.')
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
        const { error: valErr } = await supabase.from('tracker_field_values').upsert(valueRows, { onConflict: 'entry_id,field_key' })
        if (valErr) throw valErr
      }
      toastSuccess('Saved', `${rows.length} ${rows.length === 1 ? 'day' : 'days'} updated`)
      await load()
    } catch (e) {
      toastError('Could not save', e.message)
    } finally {
      setSaving(false)
    }
  }

  const rangeLabel = mode === 'week'
    ? `${format(days[0], 'dd MMM')} – ${format(days[days.length - 1], 'dd MMM yyyy')}`
    : format(anchor, 'MMMM yyyy')

  const step = (dir) => {
    if (mode === 'week') setAnchor((a) => (dir < 0 ? subWeeks(a, 1) : addWeeks(a, 1)))
    else setAnchor((a) => (dir < 0 ? subMonths(a, 1) : addMonths(a, 1)))
  }

  const thBase = 'px-2 py-2 text-[11px] font-bold text-white text-center whitespace-nowrap border-r border-white/15'

  return (
    <div className="space-y-3">
      {/* Controls — stacked on mobile */}
      <Card>
        <CardBody className="py-3 space-y-2">
          {/* Row 1: mode picker + navigation */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 flex-shrink-0">
              <button
                onClick={() => setMode('week')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition', mode === 'week' ? 'bg-white shadow-sm text-saffron-600' : 'text-slate-500')}
              >Week</button>
              <button
                onClick={() => setMode('month')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition', mode === 'month' ? 'bg-white shadow-sm text-saffron-600' : 'text-slate-500')}
              >Month</button>
            </div>

            <button onClick={() => step(-1)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0">
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex-1 text-center">
              <p className="font-bold text-slate-800 text-sm leading-tight">{rangeLabel}</p>
            </div>

            <button
              onClick={() => step(1)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Row 2: save button (only when editable) */}
          {!readOnly && (
            <Button size="sm" icon={Save} loading={saving} onClick={handleSave} className="w-full justify-center">
              Save Changes
            </Button>
          )}
        </CardBody>
      </Card>

      {/* Spreadsheet */}
      <Card className="!p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                {/* Group header row */}
                <tr className="bg-gradient-to-r from-saffron-500 to-orange-500">
                  <th className="sticky left-0 z-20 bg-saffron-500" style={{ width: DATE_W }} />
                  <th className="sticky z-20 bg-saffron-500" style={{ width: DAY_W, left: DATE_W }} />
                  {orderedGroups.map((g, gi) => {
                    const span = g.columns.reduce((n, c) => n + (c.showInput ? 1 : 0) + (c.showMarks ? 1 : 0), 0)
                    if (!span) return null
                    return (
                      <th key={g.group?.id ?? `ungrouped-${gi}`} colSpan={span} className={cn(thBase, 'text-xs')}>
                        {g.group?.label ?? 'Other'}
                      </th>
                    )
                  })}
                  {sortedColumns.length > 0 && (
                    <th colSpan={sortedColumns.length} className="bg-slate-800 text-white text-[11px] font-bold text-center" />
                  )}
                </tr>
                {/* Field / Marks header row */}
                <tr className="bg-slate-800">
                  <th className="sticky left-0 z-20 bg-slate-800 text-white text-[11px] font-bold px-2 py-2" style={{ width: DATE_W }}>Date</th>
                  <th className="sticky z-20 bg-slate-800 text-white text-[11px] font-bold px-2 py-2" style={{ width: DAY_W, left: DATE_W }}>Day</th>
                  {activeColumns.map(({ field, showInput, showMarks }) => (
                    <>
                      {showInput && <th key={`${field.key}-in`} className={thBase}>{field.label}</th>}
                      {showMarks && <th key={`${field.key}-mk`} className={cn(thBase, 'bg-black/20')}>Marks</th>}
                    </>
                  ))}
                  {sortedColumns.map((c) => (
                    <th
                      key={c.key}
                      className={cn('px-2 py-2 text-[11px] font-bold text-center whitespace-nowrap', c.is_highlighted ? 'bg-yellow-400 text-slate-900' : 'bg-slate-700 text-white')}
                      style={{ width: CALC_W }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
                {/* Max marks row */}
                <tr className="bg-orange-50">
                  <th className="sticky left-0 z-20 bg-orange-50 text-[10px] text-slate-400" style={{ width: DATE_W }} />
                  <th className="sticky z-20 bg-orange-50 text-[10px] text-slate-400" style={{ width: DAY_W, left: DATE_W }} />
                  {activeColumns.map(({ field, showInput, showMarks, hasRule }) => {
                    const max = (rulesByField[field.key] ?? []).reduce((n, r) => n + (Number(r.max_points) || 0), 0)
                    return (
                      <>
                        {showInput && <th key={`${field.key}-in-max`} className="px-2 py-1.5 text-[11px] font-semibold text-orange-700 border-r border-orange-100">{hasRule && !showMarks ? max.toFixed(2) : ''}</th>}
                        {showMarks && <th key={`${field.key}-mk-max`} className="px-2 py-1.5 text-[11px] font-semibold text-orange-700 border-r border-orange-100">{max.toFixed(2)}</th>}
                      </>
                    )
                  })}
                  {sortedColumns.map((c) => (
                    <th key={c.key} className="px-2 py-1.5 text-[11px] font-semibold text-orange-700">
                      {(summary.columnSum[c.key]?.max ?? 0).toFixed(2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d, idx) => {
                  const iso = toISO(d)
                  const values = grid[iso] ?? {}
                  const t = dayTotals[iso] ?? { fieldTotals: {}, columnTotals: {} }
                  return (
                    <tr key={iso} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                      <td className="sticky left-0 z-10 bg-inherit px-2 py-1.5 text-xs font-semibold text-slate-700 border-r border-slate-100" style={{ width: DATE_W }}>
                        {format(d, 'd MMM')}
                      </td>
                      <td className="sticky z-10 bg-inherit px-2 py-1.5 text-xs text-slate-500 border-r border-slate-100" style={{ width: DAY_W, left: DATE_W }}>
                        {format(d, 'EEE')}
                      </td>
                      {activeColumns.map(({ field, showInput, showMarks }) => (
                        <>
                          {showInput && (
                            <td key={`${field.key}-in`} className="px-1.5 py-1 border-r border-slate-100" style={{ minWidth: 90 }}>
                              {readOnly
                                ? <ReadOnlyCell field={field} value={values[field.key]} />
                                : <EditableCell field={field} value={values[field.key]} onChange={(v) => setCell(iso, field.key, v)} />}
                            </td>
                          )}
                          {showMarks && (
                            <td key={`${field.key}-mk`} className="px-2 py-1.5 text-center text-xs font-semibold text-slate-600 bg-slate-50/60 border-r border-slate-100">
                              {(t.fieldTotals[field.key]?.earned ?? 0).toFixed(2)}
                            </td>
                          )}
                        </>
                      ))}
                      {sortedColumns.map((c) => (
                        <td key={c.key} className={cn('px-2 py-1.5 text-center text-xs font-bold', c.is_highlighted ? 'bg-yellow-50 text-yellow-800' : 'text-slate-700')}>
                          {(t.columnTotals[c.key]?.earned ?? 0).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-orange-500">
                  <td className="sticky left-0 z-10 bg-orange-500" style={{ width: DATE_W }} />
                  <td className="sticky z-10 bg-orange-500 text-center text-white text-[11px] font-bold py-2" style={{ width: DAY_W, left: DATE_W }}>%</td>
                  {activeColumns.map(({ field, showInput, showMarks }) => {
                    const s = summary.fieldSum[field.key]
                    const pct = s && s.max > 0 ? ((s.earned / s.max) * 100).toFixed(1) : '0.0'
                    return (
                      <>
                        {showInput && <td key={`${field.key}-in-f`} className="border-r border-orange-400" />}
                        {showMarks && <td key={`${field.key}-mk-f`} className="text-center text-white text-[11px] font-bold py-2 border-r border-orange-400">{pct}%</td>}
                      </>
                    )
                  })}
                  {sortedColumns.map((c) => {
                    const s = summary.columnSum[c.key]
                    const pct = s && s.max > 0 ? ((s.earned / s.max) * 100).toFixed(1) : '0.0'
                    return <td key={c.key} className="text-center text-white text-[11px] font-bold py-2">{pct}%</td>
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
