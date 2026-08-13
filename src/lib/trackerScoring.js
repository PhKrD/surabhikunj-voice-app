// =====================================================================
// Tracker scoring engine — the single source of truth for turning raw
// field values into marks, group totals, calculated columns (Body/Soul/
// Total, or any admin-defined roll-up) and period (daily/weekly/monthly)
// percentages.
//
// This replaces the old inline `computeScore()` that used to live in
// TrackersPage.jsx (and was duplicated into TrackerWeeklyGrid via prop
// drilling). Every screen — the entry form, the spreadsheet table, the
// WhatsApp report and the Weekly Sadhana Card — now calls into this one
// module, so a devotee enters Sadhana once and every view of it agrees.
// =====================================================================

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function hasValue(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return true
  return String(v).trim() !== ''
}

function keyBy(list, key) {
  const out = {}
  for (const item of list ?? []) out[item[key]] = item
  return out
}

function groupByField(rules) {
  const out = {}
  for (const rule of rules ?? []) {
    if (!out[rule.field_key]) out[rule.field_key] = []
    out[rule.field_key].push(rule)
  }
  return out
}

// ---------------------------------------------------------------------
// Field-level scoring — one rule, one raw value (or the full value map,
// for `formula` rules which may reference other fields).
// ---------------------------------------------------------------------
export function calculateFieldScore(rule, fieldValues) {
  const maxPoints = Number(rule.max_points) || 0
  const cfg = rule.config ?? {}
  const rawValue = fieldValues?.[rule.field_key]

  switch (rule.rule_type) {
    case 'boolean': {
      const on = rawValue === true || rawValue === 'true' || rawValue === '1'
      return { points: on ? maxPoints : 0, max: maxPoints }
    }

    case 'threshold': {
      const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : []
      const val = String(rawValue ?? '')
      if (!val) return { points: 0, max: maxPoints }
      for (const tier of tiers) {
        if (val <= tier.by) return { points: Number(tier.pts) || 0, max: maxPoints }
      }
      return { points: 0, max: maxPoints }
    }

    // Quantity- or duration-based scoring. `full_score_at` is the target;
    // linear scale from `min` unless partial scoring is disabled, in which
    // case it's all-or-nothing. Optional overachievement bonus beyond target.
    case 'range': {
      const min = Number(cfg.min ?? 0)
      const fullAt = Number(cfg.full_score_at ?? cfg.max ?? 100)
      const allowPartial = cfg.allow_partial !== false
      const num = parseFloat(rawValue)
      if (Number.isNaN(num)) return { points: 0, max: maxPoints }

      const span = fullAt - min
      let points
      if (!allowPartial) {
        points = num >= fullAt ? maxPoints : 0
      } else if (span > 0) {
        const ratio = Math.max(0, num - min) / span
        points = Math.min(maxPoints, ratio * maxPoints)
      } else {
        points = num >= fullAt ? maxPoints : 0
      }

      const over = cfg.overachievement
      if (over?.mode === 'bonus' && num > fullAt) {
        const perUnit = Number(over.bonus_per_unit) || 0
        const unit = Number(over.unit) || 1
        const maxBonus = over.max_bonus != null ? Number(over.max_bonus) : Infinity
        const bonus = Math.min(maxBonus, Math.floor((num - fullAt) / unit) * perUnit)
        points += bonus
      }

      return { points: round2(points), max: maxPoints }
    }

    // Deducts from a budget of `max_points` (usually 0) as the value grows —
    // e.g. "Day Rest Penalty": lose 0.5 pts per 15 min of rest taken.
    case 'penalty': {
      const perUnit = Number(cfg.per_unit) || 0
      const unit = Number(cfg.unit) || 1
      const num = Math.max(0, parseFloat(rawValue) || 0)
      const deduction = Math.floor(num / unit) * perUnit
      return { points: round2(maxPoints - deduction), max: maxPoints }
    }

    case 'formula': {
      try {
        const ctx = Object.entries(fieldValues ?? {})
          .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
          .join('')
        // eslint-disable-next-line no-new-func
        const raw = new Function(`${ctx}return (${cfg.expr ?? 0});`)()
        const points = Math.min(maxPoints, Math.max(0, Number(raw) || 0))
        return { points: round2(points), max: maxPoints }
      } catch {
        return { points: 0, max: maxPoints }
      }
    }

    default:
      return { points: 0, max: maxPoints }
  }
}

// ---------------------------------------------------------------------
// All rules for one entry's worth of values → per-field {earned, max}.
// A field can have more than one rule (e.g. a base rule + a bonus rule);
// their points and max are summed.
// ---------------------------------------------------------------------
export function calculateFieldTotals(rules, fieldValues) {
  const totals = {}
  for (const rule of rules ?? []) {
    if (!totals[rule.field_key]) totals[rule.field_key] = { earned: 0, max: 0, details: [] }
    const { points, max } = calculateFieldScore(rule, fieldValues)
    totals[rule.field_key].earned += points
    totals[rule.field_key].max += max
    totals[rule.field_key].details.push({ label: rule.label, points, max })
  }
  for (const key of Object.keys(totals)) {
    totals[key].earned = round2(totals[key].earned)
    totals[key].max = round2(totals[key].max)
  }
  return totals
}

// ---------------------------------------------------------------------
// Roll fields up into their groups (Body / Pathan & Sravan / ...).
// ---------------------------------------------------------------------
export function resolveGroupTotals(groups, fields, fieldTotals) {
  const out = {}
  for (const g of groups ?? []) {
    let earned = 0
    let max = 0
    for (const f of fields ?? []) {
      if (f.group_id !== g.id) continue
      const t = fieldTotals[f.key]
      if (!t) continue
      earned += t.earned
      max += t.max
    }
    out[g.key] = { earned: round2(earned), max: round2(max) }
  }
  return out
}

// ---------------------------------------------------------------------
// Admin-defined calculated columns (Body / Soul / Total or anything
// else). Each column sums a safe list of references — never arbitrary
// code. Evaluated in sort_order so a column can reference an
// already-computed column (e.g. Total = Body + Soul).
// ---------------------------------------------------------------------
export function resolveCalculatedColumns(columns, fieldTotals, groupTotals) {
  const sorted = [...(columns ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const columnTotals = {}
  for (const col of sorted) {
    let earned = 0
    let max = 0
    for (const input of col.inputs ?? []) {
      let t = null
      if (input.type === 'field') t = fieldTotals[input.ref]
      else if (input.type === 'group') t = groupTotals[input.ref]
      else if (input.type === 'column') t = columnTotals[input.ref]
      if (t) {
        earned += t.earned
        max += t.max
      }
    }
    columnTotals[col.key] = { earned: round2(earned), max: round2(max) }
  }
  return columnTotals
}

export function pctOf(t) {
  if (!t || !t.max) return null
  return round2((t.earned / t.max) * 100)
}

// ---------------------------------------------------------------------
// Full scoring for a single entry (one day). This is what the entry
// form, the spreadsheet's per-day cell, and the WhatsApp report use.
// ---------------------------------------------------------------------
export function calculateEntryScore({ rules, fields = [], groups = [], calculatedColumns = [], fieldValues = {} }) {
  const fieldTotals = calculateFieldTotals(rules, fieldValues)
  const groupTotals = resolveGroupTotals(groups, fields, fieldTotals)
  const columnTotals = resolveCalculatedColumns(calculatedColumns, fieldTotals, groupTotals)

  let earned = 0
  let max = 0
  for (const t of Object.values(fieldTotals)) {
    earned += t.earned
    max += t.max
  }

  return {
    score: pctOf({ earned, max }),
    earned: round2(earned),
    max: round2(max),
    fieldTotals,
    groupTotals,
    columnTotals,
  }
}

// ---------------------------------------------------------------------
// Aggregate several days (weekly / monthly). `entriesByDate` is a map of
// ISO date -> { field_key: value } for every day in the period, including
// days with no submission at all (empty object) — those still count
// against the denominator unless a field opts into missed_day_behavior
// = 'exclude'.
// ---------------------------------------------------------------------
export function aggregatePeriod({ rules, fields = [], groups = [], calculatedColumns = [], entriesByDate = {} }) {
  const rulesByField = groupByField(rules)
  const fieldTotals = {}

  for (const field of fields) {
    if (field.is_active === false) continue
    const fieldRules = rulesByField[field.key] ?? []
    if (!fieldRules.length) continue

    let earned = 0
    let max = 0
    for (const values of Object.values(entriesByDate)) {
      const present = hasValue(values?.[field.key])
      if (!present && field.missed_day_behavior === 'exclude') continue

      for (const rule of fieldRules) {
        max += Number(rule.max_points) || 0
        if (present) {
          earned += calculateFieldScore(rule, values).points
        }
      }
    }
    fieldTotals[field.key] = { earned: round2(earned), max: round2(max) }
  }

  const groupTotals = resolveGroupTotals(groups, fields, fieldTotals)
  const columnTotals = resolveCalculatedColumns(calculatedColumns, fieldTotals, groupTotals)

  let earned = 0
  let max = 0
  for (const t of Object.values(fieldTotals)) {
    earned += t.earned
    max += t.max
  }

  return {
    pct: pctOf({ earned, max }),
    earned: round2(earned),
    max: round2(max),
    fieldTotals,
    groupTotals,
    columnTotals,
  }
}

export function fieldsByGroup(fields, groups) {
  const byGroup = keyBy(groups, 'id')
  const ungrouped = []
  const grouped = {}
  for (const g of groups) grouped[g.id] = []
  for (const f of fields) {
    if (f.group_id && byGroup[f.group_id]) grouped[f.group_id].push(f)
    else ungrouped.push(f)
  }
  return { grouped, ungrouped }
}
