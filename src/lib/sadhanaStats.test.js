import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSadhanaStats } from './sadhanaStats.js'

test('empty reports give zeros', () => {
  const s = computeSadhanaStats([], '2025-06-15')
  assert.equal(s.currentStreak, 0)
  assert.equal(s.longestStreak, 0)
  assert.equal(s.weekCount, 0)
  assert.equal(s.monthCount, 0)
  assert.equal(s.weekAvg, 0)
  assert.equal(s.monthAvg, 0)
})

test('counts consecutive days as the current streak', () => {
  const reports = [
    { report_date: '2025-06-15', score: 80 },
    { report_date: '2025-06-14', score: 70 },
    { report_date: '2025-06-13', score: 90 },
  ]
  const s = computeSadhanaStats(reports, '2025-06-15')
  assert.equal(s.currentStreak, 3)
  assert.equal(s.longestStreak, 3)
  assert.equal(s.monthCount, 3)
  assert.equal(s.monthAvg, 80) // (80 + 70 + 90) / 3
})

test('current streak counts from yesterday when today is missing', () => {
  const reports = [
    { report_date: '2025-06-15', score: 80 },
    { report_date: '2025-06-14', score: 70 },
  ]
  const s = computeSadhanaStats(reports, '2025-06-16')
  assert.equal(s.currentStreak, 2)
})

test('gaps break the current streak but longest is retained', () => {
  const reports = [
    { report_date: '2025-06-15', score: 80 },
    { report_date: '2025-06-14', score: 70 },
    { report_date: '2025-06-13', score: 90 },
    { report_date: '2025-06-10', score: 60 },
  ]
  const s = computeSadhanaStats(reports, '2025-06-15')
  assert.equal(s.currentStreak, 3)
  assert.equal(s.longestStreak, 3)
  assert.equal(s.monthCount, 4)
})

test('weekly rollup uses Monday as the week start', () => {
  // 2025-06-15 is a Sunday -> week start is Monday 2025-06-09
  const reports = [
    { report_date: '2025-06-15', score: 80 }, // in week
    { report_date: '2025-06-09', score: 60 }, // Monday, in week
    { report_date: '2025-06-08', score: 100 }, // before week start
  ]
  const s = computeSadhanaStats(reports, '2025-06-15')
  assert.equal(s.weekCount, 2)
  assert.equal(s.weekAvg, 70) // (80 + 60) / 2
})
