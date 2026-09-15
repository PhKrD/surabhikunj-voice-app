import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Check, Minus, Save } from 'lucide-react'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  startOfMonth, endOfMonth, addMonths, subMonths, eachDayOfInterval,
} from 'date-fns'
import { supabase } from '@/lib/supabase'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ExportMenu from '@/components/trackers/ExportMenu'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import { hasValue } from '@/lib/trackerScoring'
import { buildSheetModel } from '@/lib/trackerSheet'
import { tap, select as hapticSelect, success as hapticSuccess } from '@/lib/haptics'

const CELL_BASE = 'w-full px-2 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-xs text-primary-token focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'
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
          on ? 'bg-tulasi-500 text-white' : 'bg-[var(--surface-muted)] text-muted-token hover:bg-slate-200'
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

function ReadOnlyCell({ field, value }) {
  if (field.field_type === 'boolean') {
    const on = value === true || value === 'true' || value === '1'
    return (
      <div className={cn('w-full h-7 rounded-lg flex items-center justify-center', on ? 'bg-tulasi-100 text-tulasi-600' : 'bg-[var(--surface-muted)] text-muted-token')}>
        {on ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
      </div>
    )
  }
  return <div className="px-2 py-1.5 text-xs text-primary-token text-center truncate">{hasValue(value) ? String(value) : '–'}</div>
}

export default function TrackerSpreadsheet({
  tracker, fields = [], groups = [], rules = [], calculatedColumns = [],
  orgId, userId, readOnly = false,
  // Whose sheet this is — used to name the exported file. Defaults to the
  // tracker name for a devotee looking at their own Sadhana.
  exportTitle,
}) {
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

  // The single layout + scoring model, shared with the exporters so a
  // downloaded sheet always matches what is rendered here.
  const model = useMemo(() => buildSheetModel({
    fields, groups, rules, calculatedColumns, days, entriesByDate: grid,
  }), [fields, groups, rules, calculatedColumns, days, grid])

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

  const rowByISO = useMemo(() => {
    const out = {}
    for (const r of model.rows) out[r.iso] = r
    return out
  }, [model])

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
        const r = rowByISO[iso]
        rows.push({
          payload: {
            tracker_id: tracker.id, org_id: orgId, user_id: userId, period_date: iso,
            score: r && r.max > 0 ? Math.round((r.earned / r.max) * 100) : null,
            score_detail: r
              ? { fieldTotals: r.fieldTotals, groupTotals: r.groupTotals, columnTotals: r.columnTotals }
              : {},
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
      hapticSuccess()
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

  const [dir, setDir] = useState(0)
  const step = (d) => {
    setDir(d)
    hapticSelect()
    if (mode === 'week') setAnchor((a) => (d < 0 ? subWeeks(a, 1) : addWeeks(a, 1)))
    else setAnchor((a) => (d < 0 ? subMonths(a, 1) : addMonths(a, 1)))
  }

  // Horizontal drag on the period header pages through weeks/months, the
  // same gesture people already expect from a calendar.
  const onDragEnd = (_e, info) => {
    const { offset, velocity } = info
    if (Math.abs(offset.x) < 60 && Math.abs(velocity.x) < 400) return
    step(offset.x > 0 ? -1 : 1)
  }

  const title = exportTitle ?? tracker?.name ?? 'Sadhana'
  const exportData = useCallback(() => ({
    title,
    rangeLabel,
    sections: [{
      title,
      subtitle: `${tracker?.name ?? 'Sadhana'} · ${rangeLabel}`,
      sheetName: mode === 'week' ? format(days[0], 'dd MMM yyyy') : format(anchor, 'MMM yyyy'),
      model,
    }],
  }), [title, tracker?.name, rangeLabel, mode, days, anchor, model])

  const thBase = 'px-2 py-2 text-[11px] font-bold text-white text-center whitespace-nowrap border-r border-white/15'
  const calcCount = model.columns.filter((c) => c.kind === 'calc').length

  return (
    <div className="space-y-3">
      {/* Controls — stacked on mobile */}
      <Card>
        <CardBody className="py-3 space-y-2">
          {/* Row 1: mode picker + navigation */}
          <div className="flex items-center gap-2">
            <div className="relative flex items-center gap-1 bg-[var(--surface-muted)] rounded-xl p-1 flex-shrink-0">
              {['week', 'month'].map((m) => (
                <button
                  key={m}
                  onClick={() => { tap(); setMode(m) }}
                  className={cn(
                    'relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize',
                    mode === m ? 'text-saffron-600' : 'text-secondary-token'
                  )}
                >
                  {mode === m && (
                    <motion.span
                      layoutId="sheet-mode-pill"
                      className="absolute inset-0 rounded-lg bg-[var(--surface)] shadow-sm"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className="relative">{m}</span>
                </button>
              ))}
            </div>

            <button onClick={() => step(-1)} className="p-2 rounded-xl text-muted-token hover:text-secondary-token hover:bg-[var(--surface-muted)] flex-shrink-0 active:scale-90 transition">
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* Draggable period label — swipe left/right to page. */}
            <motion.div
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={onDragEnd}
              className="flex-1 text-center overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y"
            >
              <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                <motion.p
                  key={rangeLabel}
                  custom={dir}
                  initial={{ opacity: 0, x: dir >= 0 ? 24 : -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir >= 0 ? -24 : 24 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="font-bold text-primary-token text-sm leading-tight select-none"
                >
                  {rangeLabel}
                </motion.p>
              </AnimatePresence>
            </motion.div>

            <button
              onClick={() => step(1)}
              className="p-2 rounded-xl text-muted-token hover:text-secondary-token hover:bg-[var(--surface-muted)] flex-shrink-0 active:scale-90 transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Row 2: save + export */}
          <div className="flex items-center gap-2">
            {!readOnly && (
              <Button size="sm" icon={Save} loading={saving} onClick={handleSave} className="flex-1 justify-center">
                Save Changes
              </Button>
            )}
            <ExportMenu
              getExportData={exportData}
              disabled={loading}
              className={readOnly ? 'flex-1' : undefined}
            />
          </div>
        </CardBody>
      </Card>

      {/* Spreadsheet */}
      <Card className="!p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-token">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                {/* Group header row */}
                <tr className="bg-saffron-500">
                  <th className="sticky left-0 z-20 bg-saffron-500" style={{ width: DATE_W }} />
                  <th className="sticky z-20 bg-saffron-500" style={{ width: DAY_W, left: DATE_W }} />
                  {model.groupHeader.map((g, gi) => (
                    <th key={`${g.label}-${gi}`} colSpan={g.span} className={cn(thBase, 'text-xs')}>
                      {g.label}
                    </th>
                  ))}
                  {calcCount > 0 && (
                    <th colSpan={calcCount} className="bg-slate-800 text-white text-[11px] font-bold text-center" />
                  )}
                </tr>
                {/* Field / Marks header row */}
                <tr className="bg-slate-800">
                  <th className="sticky left-0 z-20 bg-slate-800 text-white text-[11px] font-bold px-2 py-2" style={{ width: DATE_W }}>Date</th>
                  <th className="sticky z-20 bg-slate-800 text-white text-[11px] font-bold px-2 py-2" style={{ width: DAY_W, left: DATE_W }}>Day</th>
                  {model.columns.map((col) => (
                    <th
                      key={col.id}
                      className={cn(
                        col.kind === 'calc'
                          ? cn('px-2 py-2 text-[11px] font-bold text-center whitespace-nowrap', col.isHighlighted ? 'bg-yellow-400 text-primary-token' : 'bg-slate-700 text-white')
                          : thBase,
                        col.kind === 'marks' && 'bg-black/20'
                      )}
                      style={col.kind === 'calc' ? { width: CALC_W } : undefined}
                    >
                      {col.kind === 'marks' ? col.shortLabel : col.label}
                    </th>
                  ))}
                </tr>
                {/* Max marks row */}
                <tr className="bg-orange-50">
                  <th className="sticky left-0 z-20 bg-orange-50 text-[10px] text-muted-token" style={{ width: DATE_W }} />
                  <th className="sticky z-20 bg-orange-50 text-[10px] text-muted-token" style={{ width: DAY_W, left: DATE_W }} />
                  {model.columns.map((col, i) => (
                    <th key={col.id} className="px-2 py-1.5 text-[11px] font-semibold text-orange-700 border-r border-orange-100">
                      {model.maxRow[i] == null ? '' : model.maxRow[i].toFixed(2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((row, idx) => (
                  <tr key={row.iso} className={idx % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-slate-50/60'}>
                    <td className="sticky left-0 z-10 bg-inherit px-2 py-1.5 text-xs font-semibold text-primary-token border-r border-[var(--border-color)]" style={{ width: DATE_W }}>
                      {row.dateLabel}
                    </td>
                    <td className="sticky z-10 bg-inherit px-2 py-1.5 text-xs text-secondary-token border-r border-[var(--border-color)]" style={{ width: DAY_W, left: DATE_W }}>
                      {row.dayLabel}
                    </td>
                    {model.columns.map((col, ci) => {
                      const cell = row.cells[ci]
                      if (col.kind === 'input') {
                        return (
                          <td key={col.id} className="px-1.5 py-1 border-r border-[var(--border-color)]" style={{ minWidth: 90 }}>
                            {readOnly
                              ? <ReadOnlyCell field={col.field} value={cell.raw} />
                              : (
                                <EditableCell
                                  field={col.field}
                                  value={cell.raw}
                                  onChange={(v) => setCell(row.iso, col.field.key, v)}
                                />
                              )}
                          </td>
                        )
                      }
                      if (col.kind === 'marks') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 text-center text-xs font-semibold text-secondary-token bg-slate-50/60 border-r border-[var(--border-color)]">
                            {Number(cell.raw ?? 0).toFixed(2)}
                          </td>
                        )
                      }
                      return (
                        <td key={col.id} className={cn('px-2 py-1.5 text-center text-xs font-bold', col.isHighlighted ? 'bg-yellow-50 text-yellow-800' : 'text-primary-token')}>
                          {Number(cell.raw ?? 0).toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-orange-500">
                  <td className="sticky left-0 z-10 bg-orange-500" style={{ width: DATE_W }} />
                  <td className="sticky z-10 bg-orange-500 text-center text-white text-[11px] font-bold py-2" style={{ width: DAY_W, left: DATE_W }}>%</td>
                  {model.columns.map((col, i) => (
                    <td
                      key={col.id}
                      className={cn(
                        'text-center text-white text-[11px] font-bold py-2',
                        col.kind !== 'calc' && 'border-r border-orange-400'
                      )}
                    >
                      {model.totals.pctCells[i] == null ? '' : `${model.totals.pctCells[i].toFixed(1)}%`}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
