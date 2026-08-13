import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplateVariables, renderTemplate } from './trackerWhatsapp.js'

const fields = [
  { key: 'to_bed_time', short_code: 'TB', field_type: 'time' },
  { key: 'japa_time', short_code: 'JP_TIME', field_type: 'time' },
  { key: 'japa_rounds', short_code: 'JP_ROUNDS', field_type: 'number', unit: 'rounds' },
  { key: 'day_rest_min', short_code: 'DR', field_type: 'duration_min', unit: 'mins' },
  { key: 'mangal_arti', short_code: 'MA', field_type: 'boolean' },
]

test('buildTemplateVariables formats each field by its type/unit', () => {
  const vars = buildTemplateVariables({
    tracker: { name: 'Sadhana' },
    fields,
    groups: [],
    calculatedColumns: [],
    fieldValues: { to_bed_time: '21:40', japa_time: '15:00', japa_rounds: 16, day_rest_min: 80, mangal_arti: true },
    date: new Date(2026, 7, 9), // 9 Aug 2026
    devoteeName: 'Palanhar Krsna Das',
  })

  assert.equal(vars.TB, '9:40PM')
  assert.equal(vars.JP_TIME, '3:00PM')
  assert.equal(vars.JP_ROUNDS, '16 rounds')
  assert.equal(vars.DR, '80 mins')
  assert.equal(vars.MA, 'Y')
  assert.equal(vars.DATE, '9/8/2026')
  assert.equal(vars.DEVOTEE_NAME, 'Palanhar Krsna Das')
})

test('buildTemplateVariables exposes group and calculated-column scores', () => {
  const vars = buildTemplateVariables({
    tracker: { name: 'Sadhana' },
    fields: [],
    groups: [{ key: 'body', label: 'Body' }],
    calculatedColumns: [{ key: 'total', label: 'Total' }],
    fieldValues: {},
    entryScore: {
      score: 86.5,
      groupTotals: { body: { earned: 449, max: 525 } },
      columnTotals: { total: { earned: 606, max: 700 } },
    },
    date: new Date(2026, 7, 9),
  })
  assert.equal(vars.BODY_SCORE, '85.5%')
  assert.equal(vars.TOTAL, '606')
  assert.equal(vars.TOTAL_PCT, '86.6%')
  assert.equal(vars.DAILY_PERCENTAGE, '86.5%')
})

test('renderTemplate substitutes known variables and leaves unknown ones untouched', () => {
  const out = renderTemplate('Hi {DEVOTEE_NAME}, TB: {TB}, mystery: {NOT_A_VAR}', {
    DEVOTEE_NAME: 'Palanhar', TB: '9:40PM',
  })
  assert.equal(out, 'Hi Palanhar, TB: 9:40PM, mystery: {NOT_A_VAR}')
})
