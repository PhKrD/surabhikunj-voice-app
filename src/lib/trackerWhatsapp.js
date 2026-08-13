// =====================================================================
// Configurable WhatsApp report templates.
//
// A template is plain text with {VARIABLE} placeholders. Variables are
// derived dynamically from the tracker's own configuration — nothing is
// hard-coded per-activity, so an admin who adds a brand-new field
// automatically gets a new {VARIABLE} they can drop into the template.
//
//   {DATE} {DAY} {DEVOTEE_NAME} {TRACKER_NAME}
//   {<FIELD SHORT_CODE OR KEY>}         — the raw value, formatted by type/unit
//   {<GROUP KEY>_SCORE}                 — "82.3%" for that group
//   {<CALCULATED COLUMN KEY>}           — e.g. {BODY} {SOUL} {TOTAL}
//   {<CALCULATED COLUMN KEY>_PCT}       — e.g. {TOTAL_PCT}
//   {DAILY_PERCENTAGE}
// =====================================================================

function round(n, dp = 2) {
  const f = 10 ** dp
  return Math.round((Number(n) || 0) * f) / f
}

function slugToVar(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

function formatTimeCompact(t) {
  if (!t || typeof t !== 'string' || !t.includes(':')) return t ?? ''
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return t
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 || 12
  return `${hh}:${String(m ?? 0).padStart(2, '0')}${ampm}`
}

export function formatFieldValue(field, raw) {
  if (raw === undefined || raw === null || raw === '') return ''
  if (field.field_type === 'boolean') {
    const on = raw === true || raw === 'true' || raw === '1'
    return on ? 'Y' : 'N'
  }
  if (field.field_type === 'time') return formatTimeCompact(raw)
  if (field.field_type === 'duration_min') return `${raw} ${field.unit || 'mins'}`
  if (field.unit) return `${raw} ${field.unit}`
  return String(raw)
}

// Builds the full { VAR_NAME: 'value' } map for one entry's worth of data.
export function buildTemplateVariables({
  tracker, fields = [], groups = [], calculatedColumns = [],
  fieldValues = {}, entryScore = null, date = new Date(), devoteeName = '',
}) {
  const vars = {
    DATE: format2(date),
    DAY: dayName(date),
    DEVOTEE_NAME: devoteeName ?? '',
    TRACKER_NAME: tracker?.name ?? '',
    DAILY_PERCENTAGE: entryScore?.score != null ? `${round(entryScore.score, 1)}%` : '',
  }

  for (const field of fields) {
    const code = slugToVar(field.short_code || field.key)
    if (!code) continue
    vars[code] = formatFieldValue(field, fieldValues[field.key])
  }

  for (const group of groups) {
    const code = `${slugToVar(group.key)}_SCORE`
    const t = entryScore?.groupTotals?.[group.key]
    vars[code] = t && t.max ? `${round((t.earned / t.max) * 100, 1)}%` : ''
  }

  for (const col of calculatedColumns) {
    const code = slugToVar(col.key)
    const t = entryScore?.columnTotals?.[col.key]
    vars[code] = t ? String(round(t.earned, 2)) : ''
    vars[`${code}_PCT`] = t && t.max ? `${round((t.earned / t.max) * 100, 1)}%` : ''
  }

  return vars
}

function format2(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}
function dayName(d) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
}

// Renders {VAR} placeholders. Unknown variables are left as-is so a typo
// in a custom template is visible rather than silently disappearing.
export function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{([A-Z0-9_]+)\}/g, (match, key) => (
    key in vars ? vars[key] : match
  ))
}

export const FALLBACK_TEMPLATE = `Hare Krishna Prabhuji,

date : {DATE}

{DEVOTEE_NAME}
Score: {DAILY_PERCENTAGE}

ys`
