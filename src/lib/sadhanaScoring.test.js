import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateSadhanaScore, DEFAULT_SADHANA_CONFIG } from './sadhanaScoring.js'

test('empty report scores zero', () => {
  const r = calculateSadhanaScore({})
  assert.equal(r.score, 0)
  assert.equal(r.score_japa, 0)
  assert.equal(r.score_sleep, 0)
  assert.equal(r.score_attendance, 0)
})

test('a perfect report scores 100 with full breakdown', () => {
  const r = calculateSadhanaScore({
    japa_rounds: 16,
    japa_time: '07:00',
    wake_up_time: '04:30',
    to_bed_time: '22:00',
    reading_min: 60,
    hearing_min: 60,
    seva_hours: 4,
    mangal_arti: true,
    morning_class: true,
    day_rest_min: 0,
  })
  assert.equal(r.score, 100)
  assert.equal(r.score_japa, 30)
  assert.equal(r.score_sleep, 20)
  assert.equal(r.score_reading, 15)
  assert.equal(r.score_hearing, 15)
  assert.equal(r.score_seva, 10)
  assert.equal(r.score_attendance, 10)
})

test('partial report uses tiered scoring', () => {
  const r = calculateSadhanaScore({ japa_rounds: 8, reading_min: 30 })
  assert.equal(r.score_japa, 7.5) // 8/16 * 15
  assert.equal(r.score_reading, 9)
  assert.equal(r.score, 16.5)
})

test('day rest applies a capped penalty', () => {
  const base = calculateSadhanaScore({ mangal_arti: true, morning_class: true })
  assert.equal(base.score, 10)
  const penalised = calculateSadhanaScore({ mangal_arti: true, morning_class: true, day_rest_min: 60 })
  // floor(60/15) * 0.5 = 2 -> 10 - 2 = 8
  assert.equal(penalised.score, 8)
  const capped = calculateSadhanaScore({ mangal_arti: true, morning_class: true, day_rest_min: 600 })
  // penalty capped at 5 -> max(0, 10 - 5) = 5
  assert.equal(capped.score, 5)
})

test('post-midnight to-bed time is treated as late evening', () => {
  // 22:00 is on-time (full 10), 00:30 should be adjusted to 24:30 (late, 0 sleep-from-bed)
  const onTime = calculateSadhanaScore({ to_bed_time: '22:00' })
  const late = calculateSadhanaScore({ to_bed_time: '00:30' })
  assert.ok(onTime.score_sleep > late.score_sleep)
})

test('per-VOICE config overrides points', () => {
  const r = calculateSadhanaScore(
    { mangal_arti: true, morning_class: false },
    { ...DEFAULT_SADHANA_CONFIG, mangalArtiPoints: 8 }
  )
  assert.equal(r.score_attendance, 8)
  assert.equal(r.score, 8)
})
