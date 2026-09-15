// =====================================================================
// trackerSheet.js — the shared LAYOUT model for the Sadhana sheet.
//
// TrackerSpreadsheet renders this on screen and the CSV/Excel/PDF
// exporters emit it to a file. Both go through this one builder so an
// exported sheet is guaranteed to have the same columns, group headers,
// max-marks row and totals as what the devotee was just looking at —
// previously the export would have had to re-derive all of that and
// could silently drift.
//
// Scoring itself is NOT done here; it is delegated to trackerScoring.js.
// =====================================================================
import { format } from 'date-fns'
// Relative imports (not the '@/' alias) so this module stays runnable
// under plain `node --test` alongside trackerScoring.
import {
  calculateFieldScore, hasValue, resolveGroupTotals, resolveCalculatedColumns,
} from './trackerScoring.js'
import { formatFieldValue } from './trackerWhatsapp.js'

export function toISO(d) { return format(d, 'yyyy-MM-dd') }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

export function groupRulesByField(rules) {
  const out = {}
  for (const r of rules ?? []) {
    if (!out[r.field_key]) out[r.field_key] = []
    out[r.field_key].push(r)
  }
  return out
}

// Which columns to render per field: raw input column, marks column,
// both, or neither. A field is never fully hidden.
export function buildColumnPlan(fields, rulesByField) {
  return (fields ?? []).filter((f) => f.is_active !== false).map((f) => {
    const hasRule = (rulesByField[f.key]?.length ?? 0) > 0
    let showInput = f.show_input !== false
    const showMarks = f.show_marks !== false && hasRule
    if (!showInput && !showMarks) showInput = true
    return { field: f, showInput, showMarks, hasRule }
  })
}

// Active groups in sort order, plus an implicit "Other" bucket holding
// any field that is ungrouped or points at an inactive group.
export function buildOrderedGroups(groups, columnPlan) {
  const active = [...(groups ?? [])]
    .filter((g) => g.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const grouped = active.map((g) => ({
    group: g,
    columns: columnPlan.filter((c) => c.field.group_id === g.id),
  }))
  const ungrouped = columnPlan.filter(
    (c) => !c.field.group_id || !active.some((g) => g.id === c.field.group_id)
  )
  return ungrouped.length ? [...grouped, { group: null, columns: ungrouped }] : grouped
}

export function sortCalculatedColumns(calculatedColumns) {
  return [...(calculatedColumns ?? [])]
    .filter((c) => c.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

function maxPointsFor(rulesByField, key) {
  return (rulesByField[key] ?? []).reduce((n, r) => n + (Number(r.max_points) || 0), 0)
}

/**
 * Build the complete sheet model for a set of days.
 *
 * @param {object[]} days            Date objects, in display order.
 * @param {object}   entriesByDate   ISO date -> { field_key: raw value }
 * @returns {{
 *   groupHeader: {label: string, span: number}[],
 *   columns: object[],
 *   maxRow: (number|null)[],
 *   rows: object[],
 *   totals: object,
 * }}
 */
export function buildSheetModel({
  fields = [], groups = [], rules = [], calculatedColumns = [],
  days = [], entriesByDate = {},
}) {
  const rulesByField = groupRulesByField(rules)
  const columnPlan = buildColumnPlan(fields, rulesByField)
  const orderedGroups = buildOrderedGroups(groups, columnPlan)
  const calcColumns = sortCalculatedColumns(calculatedColumns)

  // ---- Columns, flattened in group order -----------------------------
  const columns = []
  const groupHeader = []
  for (const g of orderedGroups) {
    let span = 0
    for (const c of g.columns) {
      if (c.showInput) {
        columns.push({
          id: `${c.field.key}__in`, label: c.field.label, kind: 'input',
          field: c.field, group: g.group,
          maxPoints: c.hasRule && !c.showMarks ? maxPointsFor(rulesByField, c.field.key) : null,
        })
        span += 1
      }
      if (c.showMarks) {
        columns.push({
          id: `${c.field.key}__mk`, label: `${c.field.label} — Marks`, shortLabel: 'Marks',
          kind: 'marks', field: c.field, group: g.group,
          maxPoints: maxPointsFor(rulesByField, c.field.key),
        })
        span += 1
      }
    }
    if (span) groupHeader.push({ label: g.group?.label ?? 'Other', span })
  }
  for (const c of calcColumns) {
    columns.push({
      id: `calc__${c.key}`, label: c.label, kind: 'calc', calc: c,
      isHighlighted: !!c.is_highlighted, maxPoints: null,
    })
  }

  // ---- Per-day scoring ------------------------------------------------
  const rows = []
  const colSum = {}
  for (const d of days) {
    const iso = toISO(d)
    const values = entriesByDate[iso] ?? {}
    const filled = Object.values(values).some((v) => hasValue(v))

    const fieldTotals = {}
    for (const { field, hasRule } of columnPlan) {
      if (!hasRule) continue
      let earned = 0
      let max = 0
      for (const rule of rulesByField[field.key] ?? []) {
        max += Number(rule.max_points) || 0
        if (hasValue(values[field.key])) earned += calculateFieldScore(rule, values).points
      }
      fieldTotals[field.key] = { earned: round2(earned), max: round2(max) }
    }
    const groupTotals = resolveGroupTotals(groups, fields, fieldTotals)
    const columnTotals = resolveCalculatedColumns(calcColumns, fieldTotals, groupTotals)

    const cells = columns.map((col) => {
      if (col.kind === 'input') {
        const raw = values[col.field.key]
        return { kind: 'input', raw, text: formatFieldValue(col.field, raw) }
      }
      if (col.kind === 'marks') {
        const n = fieldTotals[col.field.key]?.earned ?? 0
        return { kind: 'marks', raw: n, text: filled ? n.toFixed(2) : '' }
      }
      const n = columnTotals[col.calc.key]?.earned ?? 0
      return { kind: 'calc', raw: n, text: filled ? n.toFixed(2) : '' }
    })

    // Running totals for the footer.
    columns.forEach((col, i) => {
      if (col.kind === 'input') return
      const bucket = (colSum[col.id] = colSum[col.id] ?? { earned: 0, max: 0 })
      bucket.earned += Number(cells[i].raw) || 0
      if (col.kind === 'marks') bucket.max += fieldTotals[col.field.key]?.max ?? 0
      else bucket.max += columnTotals[col.calc.key]?.max ?? 0
    })

    let earned = 0
    let max = 0
    for (const t of Object.values(fieldTotals)) { earned += t.earned; max += t.max }

    rows.push({
      iso,
      dateLabel: format(d, 'd MMM'),
      dayLabel: format(d, 'EEE'),
      filled,
      cells,
      // Persisted verbatim as tracker_entries.score_detail — keep the shape.
      fieldTotals,
      groupTotals,
      columnTotals,
      pct: max > 0 && filled ? round2((earned / max) * 100) : null,
      earned: round2(earned),
      max: round2(max),
    })
  }

  const maxRow = columns.map((col) => (col.kind === 'calc'
    ? round2(colSum[col.id]?.max ?? 0)
    : (col.maxPoints != null ? round2(col.maxPoints) : null)))

  const grandEarned = round2(rows.reduce((n, r) => n + r.earned, 0))
  const grandMax = round2(rows.reduce((n, r) => n + r.max, 0))

  return {
    groupHeader,
    columns,
    maxRow,
    rows,
    totals: {
      cells: columns.map((col) => (col.kind === 'input'
        ? null
        : round2(colSum[col.id]?.earned ?? 0))),
      // Per-column percentage, as shown in the on-screen footer strip.
      pctCells: columns.map((col) => {
        if (col.kind === 'input') return null
        const s = colSum[col.id]
        return s && s.max > 0 ? round2((s.earned / s.max) * 100) : 0
      }),
      earned: grandEarned,
      max: grandMax,
      pct: grandMax > 0 ? round2((grandEarned / grandMax) * 100) : null,
      daysFilled: rows.filter((r) => r.filled).length,
      daysTotal: rows.length,
    },
  }
}
