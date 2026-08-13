import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateFieldScore,
  calculateFieldTotals,
  resolveGroupTotals,
  resolveCalculatedColumns,
  calculateEntryScore,
  aggregatePeriod,
  pctOf,
} from './trackerScoring.js'

// ── boolean ────────────────────────────────────────────────────────────
test('boolean rule: true awards full points, false/missing awards zero', () => {
  const rule = { rule_type: 'boolean', field_key: 'mangal_arti', max_points: 35, config: {} }
  assert.equal(calculateFieldScore(rule, { mangal_arti: true }).points, 35)
  assert.equal(calculateFieldScore(rule, { mangal_arti: 'true' }).points, 35)
  assert.equal(calculateFieldScore(rule, { mangal_arti: false }).points, 0)
  assert.equal(calculateFieldScore(rule, {}).points, 0)
})

// ── threshold ────────────────────────────────────────────────────────────
test('threshold rule: first tier the value is <= wins', () => {
  const rule = {
    rule_type: 'threshold', field_key: 'wake_up_time', max_points: 10,
    config: { tiers: [{ by: '04:30', pts: 10 }, { by: '05:00', pts: 7 }, { by: '23:59', pts: 0 }] },
  }
  assert.equal(calculateFieldScore(rule, { wake_up_time: '04:15' }).points, 10)
  assert.equal(calculateFieldScore(rule, { wake_up_time: '04:45' }).points, 7)
  assert.equal(calculateFieldScore(rule, { wake_up_time: '09:00' }).points, 0)
  assert.equal(calculateFieldScore(rule, {}).points, 0)
})

// ── range: partial scoring ────────────────────────────────────────────────────────────
test('range rule with partial scoring scales linearly to the target', () => {
  const rule = {
    rule_type: 'range', field_key: 'japa_rounds', max_points: 175,
    config: { min: 0, full_score_at: 16, allow_partial: true },
  }
  assert.equal(calculateFieldScore(rule, { japa_rounds: 16 }).points, 175)
  assert.equal(calculateFieldScore(rule, { japa_rounds: 8 }).points, 87.5)
  assert.equal(calculateFieldScore(rule, { japa_rounds: 0 }).points, 0)
  // over target with no overachievement config just caps at max_points
  assert.equal(calculateFieldScore(rule, { japa_rounds: 20 }).points, 175)
})

test('range rule with partial scoring disabled is all-or-nothing', () => {
  const rule = {
    rule_type: 'range', field_key: 'seva_hours', max_points: 40,
    config: { min: 0, full_score_at: 4, allow_partial: false },
  }
  assert.equal(calculateFieldScore(rule, { seva_hours: 4 }).points, 40)
  assert.equal(calculateFieldScore(rule, { seva_hours: 3.9 }).points, 0)
})

test('range rule with a bonus overachievement mode rewards exceeding target', () => {
  const rule = {
    rule_type: 'range', field_key: 'japa_rounds', max_points: 175,
    config: {
      min: 0, full_score_at: 16, allow_partial: true,
      overachievement: { mode: 'bonus', bonus_per_unit: 5, unit: 4, max_bonus: 20 },
    },
  }
  // 24 rounds = 8 rounds over target = 2 units of 4 => +10 bonus
  assert.equal(calculateFieldScore(rule, { japa_rounds: 24 }).points, 185)
  // way over target, bonus caps at max_bonus (20)
  assert.equal(calculateFieldScore(rule, { japa_rounds: 100 }).points, 195)
})

// ── penalty (previously a no-op bug — now actually deducts) ────────────────────────────────────────────────────────────
test('penalty rule deducts proportionally instead of always granting max_points', () => {
  const rule = {
    rule_type: 'penalty', field_key: 'day_rest_min', max_points: 0,
    config: { per_unit: 0.5, unit: 15 },
  }
  assert.equal(calculateFieldScore(rule, { day_rest_min: 0 }).points, 0)
  assert.equal(calculateFieldScore(rule, { day_rest_min: 30 }).points, -1)
  assert.equal(calculateFieldScore(rule, { day_rest_min: 45 }).points, -1.5)
})

// ── formula ────────────────────────────────────────────────────────────
test('formula rule evaluates against the full value map and clamps to [0, max]', () => {
  const rule = {
    rule_type: 'formula', field_key: 'japa_rounds', max_points: 175,
    config: { expr: 'japa_rounds * 10.9375' },
  }
  assert.equal(calculateFieldScore(rule, { japa_rounds: 16 }).points, 175)
  assert.equal(calculateFieldScore(rule, { japa_rounds: 0 }).points, 0)
})

// ── field totals: multiple rules per field sum together ────────────────────────────────────────────────────────────
test('calculateFieldTotals sums multiple rules attached to the same field', () => {
  const rules = [
    { rule_type: 'range', field_key: 'japa_rounds', max_points: 150, config: { full_score_at: 16 } },
    { rule_type: 'threshold', field_key: 'japa_rounds', max_points: 25, config: { tiers: [{ by: '99', pts: 25 }] } },
  ]
  const totals = calculateFieldTotals(rules, { japa_rounds: 16 })
  assert.equal(totals.japa_rounds.earned, 175)
  assert.equal(totals.japa_rounds.max, 175)
  assert.equal(totals.japa_rounds.details.length, 2)
})

// ── groups + calculated columns (Body / Soul / Total) ────────────────────────────────────────────────────────────
test('groups and calculated columns mirror the Body / Soul / Total spreadsheet', () => {
  const groups = [
    { id: 'g-body', key: 'body', label: 'Body' },
    { id: 'g-soul', key: 'soul', label: 'Pathan & Sravan' },
  ]
  const fields = [
    { key: 'tb', group_id: 'g-body' },
    { key: 'wu', group_id: 'g-body' },
    { key: 'dr', group_id: 'g-body' },
    { key: 'japa', group_id: 'g-soul' },
    { key: 'reading', group_id: 'g-soul' },
  ]
  const rules = [
    { rule_type: 'boolean', field_key: 'tb', max_points: 175, config: {} },
    { rule_type: 'boolean', field_key: 'wu', max_points: 175, config: {} },
    { rule_type: 'boolean', field_key: 'dr', max_points: 175, config: {} },
    { rule_type: 'boolean', field_key: 'japa', max_points: 175, config: {} },
    { rule_type: 'boolean', field_key: 'reading', max_points: 75, config: {} },
  ]
  const calculatedColumns = [
    { key: 'body', label: 'Body', sort_order: 10, inputs: [{ type: 'group', ref: 'body' }] },
    { key: 'soul', label: 'Soul', sort_order: 20, inputs: [{ type: 'group', ref: 'soul' }] },
    { key: 'total', label: 'Total', sort_order: 30, inputs: [{ type: 'column', ref: 'body' }, { type: 'column', ref: 'soul' }] },
  ]

  const result = calculateEntryScore({
    rules, fields, groups, calculatedColumns,
    fieldValues: { tb: true, wu: true, dr: true, japa: true, reading: true },
  })

  assert.equal(result.groupTotals.body.earned, 525)
  assert.equal(result.groupTotals.soul.earned, 250)
  assert.equal(result.columnTotals.body.earned, 525)
  assert.equal(result.columnTotals.soul.earned, 250)
  assert.equal(result.columnTotals.total.earned, 775)
  assert.equal(result.columnTotals.total.max, 775)
  assert.equal(result.score, 100)
})

// ── period aggregation + missed-day behavior ────────────────────────────────────────────────────────────
test('aggregatePeriod counts a day with no submission as zero by default', () => {
  const fields = [{ key: 'japa', is_active: true, missed_day_behavior: 'zero' }]
  const rules = [{ rule_type: 'range', field_key: 'japa', max_points: 175, config: { full_score_at: 16 } }]
  const result = aggregatePeriod({
    rules, fields, groups: [], calculatedColumns: [],
    entriesByDate: {
      '2026-08-03': { japa: 16 },
      '2026-08-04': {},          // missed day
      '2026-08-05': { japa: 8 },
    },
  })
  // max counted for all 3 days (175*3=525), earned only for days with data (175+0+87.5)
  assert.equal(result.max, 525)
  assert.equal(result.earned, 262.5)
})

test('aggregatePeriod excludes missed days from the denominator when configured', () => {
  const fields = [{ key: 'seva', is_active: true, missed_day_behavior: 'exclude' }]
  const rules = [{ rule_type: 'range', field_key: 'seva', max_points: 40, config: { full_score_at: 4 } }]
  const result = aggregatePeriod({
    rules, fields, groups: [], calculatedColumns: [],
    entriesByDate: {
      '2026-08-03': { seva: 4 },
      '2026-08-04': {},          // excluded entirely
      '2026-08-05': { seva: 2 },
    },
  })
  // only 2 days counted in the denominator (40*2=80), not 3
  assert.equal(result.max, 80)
  assert.equal(result.earned, 60)
  assert.equal(result.pct, 75)
})

test('pctOf returns null when there is no applicable maximum', () => {
  assert.equal(pctOf({ earned: 0, max: 0 }), null)
  assert.equal(pctOf(null), null)
})

test('resolveCalculatedColumns evaluates in sort_order so Total can reference Body + Soul', () => {
  const fieldTotals = { a: { earned: 10, max: 20 }, b: { earned: 5, max: 10 } }
  const groupTotals = {}
  const columns = [
    { key: 'total', label: 'Total', sort_order: 20, inputs: [{ type: 'column', ref: 'sum' }] },
    { key: 'sum', label: 'Sum', sort_order: 10, inputs: [{ type: 'field', ref: 'a' }, { type: 'field', ref: 'b' }] },
  ]
  const out = resolveCalculatedColumns(columns, fieldTotals, groupTotals)
  assert.equal(out.sum.earned, 15)
  assert.equal(out.total.earned, 15)
})
