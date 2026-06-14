// Pure helpers for sadhana streaks and weekly/monthly rollups.
// report_date values are 'YYYY-MM-DD' strings; all date math is done in UTC so
// it matches how reports are stored.

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]
}

export function computeSadhanaStats(reports, todayStr = new Date().toISOString().split('T')[0]) {
  const list = reports || []
  const dates = new Set(list.map((r) => r.report_date))

  // Current streak: count back from today (or yesterday if today isn't reported yet).
  let cursor = todayStr
  if (!dates.has(cursor)) cursor = addDays(cursor, -1)
  let currentStreak = 0
  while (dates.has(cursor)) {
    currentStreak += 1
    cursor = addDays(cursor, -1)
  }

  // Longest streak: scan sorted unique dates for the longest consecutive run.
  let longestStreak = 0
  let run = 0
  let prev = null
  for (const ds of [...dates].sort()) {
    run = prev && addDays(prev, 1) === ds ? run + 1 : 1
    if (run > longestStreak) longestStreak = run
    prev = ds
  }

  // Weekly (Mon-start) and monthly rollups.
  const dow = new Date(todayStr + 'T00:00:00Z').getUTCDay()
  const weekStart = addDays(todayStr, -((dow + 6) % 7))
  const monthStart = `${todayStr.slice(0, 8)}01`
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, r) => s + (r.score ?? 0), 0) / arr.length) : 0)
  const weekReports = list.filter((r) => r.report_date >= weekStart)
  const monthReports = list.filter((r) => r.report_date >= monthStart)

  return {
    currentStreak,
    longestStreak,
    weekAvg: avg(weekReports),
    weekCount: weekReports.length,
    monthAvg: avg(monthReports),
    monthCount: monthReports.length,
  }
}
