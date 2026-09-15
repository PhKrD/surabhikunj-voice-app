import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSheetModel } from './trackerSheet.js'
import { toCsv } from './trackerExport.js'

// A miniature Sadhana sheet: one time field scored with bands, one
// numeric field scored with a range, grouped, plus a Total column.
const groups = [
  { id: 'g1', key: 'body', label: 'Body', sort_order: 10 },
  { id: 'g2', key: 'soul', label: 'Soul', sort_order: 20 },
]

const fields = [
  { key: 'wake_up_time', label: 'Wake Up', field_type: 'time', group_id: 'g1', sort_order: 10 },
  { key: 'japa_rounds', label: 'Japa', field_type: 'number', group_id: 'g2', sort_order: 20 },
]

const rules = [
  {
    field_key: 'wake_up_time', rule_type: 'band', max_points: 25,
    config: {
      bands: [
        { from: '03:30', to: '03:45', pts: 25 },
        { from: '03:45', to: '04:00', pts: 20 },
      ],
      default_pts: 0,
    },
  },
  {
    field_key: 'japa_rounds', rule_type: 'range', max_points: 16,
    config: { min: 0, full_score_at: 16, allow_partial: true },
  },
]

const calculatedColumns = [
  { key: 'total', label: 'Total', sort_order: 10, is_highlighted: true, inputs: [{ type: 'group', ref: 'body' }, { type: 'group', ref: 'soul' }] },
]

const days = [new Date('2026-01-05T00:00:00'), new Date('2026-01-06T00:00:00')]

function build(entriesByDate) {
  return buildSheetModel({ fields, groups, rules, calculatedColumns, days, entriesByDate })
}

test('sheet model lays out group headers spanning their input + marks columns', () => {
  const model = build({})
  assert.deepEqual(model.groupHeader, [
    { label: 'Body', span: 2 },
    { label: 'Soul', span: 2 },
  ])
  assert.deepEqual(
    model.columns.map((c) => c.id),
    ['wake_up_time__in', 'wake_up_time__mk', 'japa_rounds__in', 'japa_rounds__mk', 'calc__total']
  )
})

test('sheet model max row shows each rule maximum, blank for input columns', () => {
  const model = build({})
  // [wake input, wake marks, japa input, japa marks, total]. A calculated
  // column's max is the period total (41 available per day x 2 days),
  // which is what the on-screen footer has always shown.
  assert.deepEqual(model.maxRow, [null, 25, null, 16, 82])
})

test('sheet model scores each day and rolls up a total column', () => {
  const model = build({
    '2026-01-05': { wake_up_time: '03:40', japa_rounds: '16' },
    '2026-01-06': { wake_up_time: '03:50', japa_rounds: '8' },
  })

  const [d1, d2] = model.rows
  assert.equal(d1.cells[1].raw, 25)   // band 03:30–03:45
  assert.equal(d1.cells[3].raw, 16)   // full japa
  assert.equal(d1.cells[4].raw, 41)   // total
  assert.equal(d1.pct, 100)

  assert.equal(d2.cells[1].raw, 20)   // band 03:45–04:00
  assert.equal(d2.cells[3].raw, 8)
  assert.equal(d2.cells[4].raw, 28)

  assert.equal(model.totals.earned, 69)
  assert.equal(model.totals.max, 82)
  assert.equal(model.totals.daysFilled, 2)
})

test('sheet model leaves marks blank for a day with no submission', () => {
  const model = build({ '2026-01-05': { wake_up_time: '03:40', japa_rounds: '16' } })
  const empty = model.rows[1]
  assert.equal(empty.filled, false)
  assert.equal(empty.cells[1].text, '')
  assert.equal(empty.pct, null)
  // A missed day still counts against the denominator.
  assert.equal(model.totals.max, 82)
  assert.equal(model.totals.daysFilled, 1)
})

test('sheet model formats input cells for display', () => {
  const model = build({ '2026-01-05': { wake_up_time: '03:40', japa_rounds: '16' } })
  assert.equal(model.rows[0].cells[0].text, '3:40AM')
  assert.equal(model.rows[0].cells[2].text, '16')
})

// ── CSV export ─────────────────────────────────────────────────────────
test('CSV export reproduces the on-screen header, max and total rows', () => {
  const model = build({
    '2026-01-05': { wake_up_time: '03:40', japa_rounds: '16' },
    '2026-01-06': { wake_up_time: '03:50', japa_rounds: '8' },
  })
  const csv = toCsv([{ title: 'Sadhana', model }], { title: 'Sadhana', rangeLabel: 'Jan 2026' })
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n')

  // Group banner is offset past the Date + Day columns and padded to span.
  assert.ok(lines.includes(',,Body,,Soul,,Totals'))
  assert.ok(lines.includes('Date,Day,Wake Up,Wake Up — Marks,Japa,Japa — Marks,Total'))
  assert.ok(lines.includes(',Max,,25,,16,82'))
  assert.ok(lines.includes('5 Jan,Mon,3:40AM,25.00,16,16.00,41.00'))
  assert.ok(lines.includes('6 Jan,Tue,3:50AM,20.00,8,8.00,28.00'))
  assert.ok(lines.some((l) => l.startsWith('Total,84.15%')))
})

test('CSV export quotes values containing commas', () => {
  const model = buildSheetModel({
    fields: [{ key: 'note', label: 'Note, if any', field_type: 'text', sort_order: 10 }],
    groups: [], rules: [], calculatedColumns: [],
    days: [days[0]],
    entriesByDate: { '2026-01-05': { note: 'chanted, read, rested' } },
  })
  const csv = toCsv([{ title: 'T', model }])
  assert.ok(csv.includes('"Note, if any"'))
  assert.ok(csv.includes('"chanted, read, rested"'))
})
