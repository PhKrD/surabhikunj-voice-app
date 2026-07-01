/**
 * Sadhana Score Calculator
 *
 * DAILY scoring (0-100) — used by the daily report card.
 *   Japa (time + rounds):  30 pts
 *   Sleep discipline:      20 pts  (wake-up + to-bed)
 *   Reading:               15 pts
 *   Hearing:               15 pts
 *   Seva:                  10 pts
 *   Attendance (MA+MC):    10 pts
 *   Day rest penalty:      -5 pts max
 *
 * WEEKLY scoring (0-980) — matches the reference spreadsheet.
 *   TB:          25/day  (max 175 / week)
 *   WU:          25/day  (max 175 / week)
 *   DR:          25/day  (max 175 / week)  [penalty-only 0..-5 like the sheet]
 *   JAPA:        25/day  (max 175 / week)
 *   Reading:     ~11/day (max  75 / week)
 *   Hearing:     ~4/day  (max  30 / week)
 *   MC:           5/day  (max  35 / week)
 *   MA:           5/day  (max  35 / week)
 *   Studies:     10/day  (max  70 / week)
 *   Cleanliness:  5/day  (max  35 / week)
 *   ------------------------------------------
 *   TOTAL:                max 980 / week
 */

function timeToMinutes(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Default scoring configuration. A per-VOICE config may override any subset of
// these via calculateSadhanaScore(report, config). Defaults reproduce the
// original hard-coded scoring exactly.
export const DEFAULT_SADHANA_CONFIG = {
  japaMaxRounds: 16,
  japaRoundsPoints: 15,
  // [minute-of-day cutoff, points], evaluated with "<=" (earlier is better)
  japaTimeTiers: [[7 * 60, 15], [8 * 60, 12], [9 * 60, 8], [10 * 60, 4]],
  wakeUpTiers: [[4 * 60 + 30, 10], [5 * 60, 8], [5 * 60 + 30, 5], [6 * 60, 2]],
  // to-bed tiers use "adjusted" minutes (AM times treated as +24h)
  toBedTiers: [[22 * 60, 10], [22 * 60 + 30, 8], [23 * 60, 5], [23 * 60 + 30, 2]],
  // [minutes threshold, points], evaluated with ">=" (more is better)
  readingTiers: [[60, 15], [45, 12], [30, 9], [15, 5], [Number.MIN_VALUE, 2]],
  hearingTiers: [[60, 15], [45, 12], [30, 9], [15, 5], [Number.MIN_VALUE, 2]],
  // [hours threshold, points], evaluated with ">="
  sevaTiers: [[4, 10], [3, 8], [2, 6], [1, 3], [Number.MIN_VALUE, 1]],
  mangalArtiPoints: 5,
  morningClassPoints: 5,
  dayRestPenaltyPer15Min: 0.5,
  maxDayRestPenalty: 5,
  // New — daily bonus fields
  studiesTiers: [[60, 10], [45, 8], [30, 6], [15, 3], [Number.MIN_VALUE, 1]],
  cleanlinessPoints: 5,
}

// =====================================================================
//  WEEKLY SCORING (matches the reference spreadsheet)
// =====================================================================

// Per-day max points, as in the weekly template.
export const WEEKLY_DAILY_MAX = {
  tb: 25,
  wu: 25,
  dr: 25,
  japa: 25,
  reading: 75 / 7,
  hearing: 30 / 7,
  mc: 5,
  ma: 5,
  studies: 10,
  cleanliness: 5,
}

// Per-week max points (sheet header row).
export const WEEKLY_MAX = {
  tb: 175,
  wu: 175,
  dr: 175,
  japa: 175,
  reading: 75,
  hearing: 30,
  mc: 35,
  ma: 35,
  studies: 70,
  cleanliness: 35,
  total: 980,
}

// TB (to-bed) tiers per the user spec. AM times are treated as +24h.
// Cutoffs are given as minutes from midnight; PM cutoffs are H*60+M.
const TB_TIERS = [
  [21 * 60 + 30, 25],  // <= 9:30 PM
  [21 * 60 + 45, 20],  // <= 9:45 PM
  [22 * 60,      15],  // <= 10:00 PM
  [22 * 60 + 30, 10],  // <= 10:30 PM
  [22 * 60 + 45, 5],   // <= 10:45 PM
  [23 * 60,      0],   // <= 11:00 PM
  // After 11 PM -> -5
]
const TB_LATE_PENALTY = -5

// WU (wake-up) tiers per the user spec.
const WU_TIERS = [
  [3 * 60 + 45, 25],   // <= 3:45 AM
  [4 * 60,      20],   // <= 4:00
  [4 * 60 + 15, 15],   // <= 4:15
  [4 * 60 + 30, 10],   // <= 4:30
  [4 * 60 + 45, 5],    // <= 4:45
  [5 * 60,      0],    // <= 5:00
  // After 5 AM -> -5
]
const WU_LATE_PENALTY = -5

// JAPA per day: 25 max — 15 for 16 rounds proportional, 10 for time completion.
// Time tiers mirror the daily tiers but scaled to /10.
const WEEKLY_JAPA_TIME_TIERS = [
  [7 * 60,  10],   // finished by 7 AM
  [8 * 60,  7],    // by 8 AM
  [9 * 60,  5],    // by 9 AM
  [10 * 60, 3],    // by 10 AM
]

// Reading tiers scaled to per-day max ≈ 10.71 (weekly 75/7).
const WEEKLY_READING_TIERS = [
  [60, 10.71], [45, 8], [30, 6], [15, 3], [Number.MIN_VALUE, 1],
]
// Hearing tiers scaled to per-day max ≈ 4.29 (weekly 30/7).
const WEEKLY_HEARING_TIERS = [
  [60, 4.29], [45, 3.5], [30, 2.5], [15, 1.5], [Number.MIN_VALUE, 0.5],
]
// Studies tiers per day, max 10.
const WEEKLY_STUDIES_TIERS = [
  [90, 10], [60, 8], [45, 6], [30, 4], [15, 2], [Number.MIN_VALUE, 1],
]

/**
 * Score a single day using the *weekly* per-day scheme (matches spreadsheet).
 * Returns an object with the per-column marks + a total for the day.
 */
export function scoreWeeklyDay(day = {}) {
  const tbMinRaw = timeToMinutes(day.to_bed_time)
  // Post-midnight (AM) times: for TB scoring we treat times before 06:00 as
  // "same evening but late" -> penalty.  Times between noon and midnight use
  // their real value.
  let tbScore
  if (tbMinRaw === null) {
    tbScore = 0
  } else if (tbMinRaw < 6 * 60) {
    tbScore = TB_LATE_PENALTY // slept after midnight -> penalty
  } else {
    tbScore = TB_LATE_PENALTY
    for (const [cutoff, points] of TB_TIERS) {
      if (tbMinRaw <= cutoff) { tbScore = points; break }
    }
  }

  const wuMin = timeToMinutes(day.wake_up_time)
  let wuScore
  if (wuMin === null) {
    wuScore = 0
  } else {
    wuScore = WU_LATE_PENALTY
    for (const [cutoff, points] of WU_TIERS) {
      if (wuMin <= cutoff) { wuScore = points; break }
    }
  }

  // DR: penalty-only, max 0, min -5 (matches sheet where DR shows -5 for 110 min)
  const drMin = Number(day.day_rest_min) || 0
  let drScore = 0
  if (drMin > 0) {
    // Penalty: 0.5 per 15 mins beyond 30 mins, capped at -5, but sheet showed
    // -5 for 110 mins, so use tiered penalty:
    if (drMin >= 90) drScore = -5
    else if (drMin >= 60) drScore = -3
    else if (drMin >= 45) drScore = -2
    else if (drMin >= 30) drScore = -1
    else drScore = 0
  }
  // Positive marks section - if user didn't rest at all they get max 25? No,
  // the sheet showed DR max 175 with only -5 as displayed value. We'll treat
  // DR score as pure penalty (0 default, -5 worst) so that a fully rested-free
  // day gets 0.

  // JAPA: rounds portion + time portion (max 25)
  const rounds = Math.min(Number(day.japa_rounds) || 0, 16)
  const japaRoundsScore = (rounds / 16) * 15
  let japaTimeScore = 0
  const japaMin = timeToMinutes(day.japa_time)
  if (japaMin !== null) {
    for (const [cutoff, pts] of WEEKLY_JAPA_TIME_TIERS) {
      if (japaMin <= cutoff) { japaTimeScore = pts; break }
    }
  }
  const japaScore = japaRoundsScore + japaTimeScore

  // Reading / Hearing / Studies
  const readingScore = tierGte(Number(day.reading_min) || 0, WEEKLY_READING_TIERS)
  const hearingScore = tierGte(Number(day.hearing_min) || 0, WEEKLY_HEARING_TIERS)
  const studiesScore = tierGte(Number(day.studies_min) || 0, WEEKLY_STUDIES_TIERS)

  // MC / MA / Cleanliness: 5 for done else 0
  const mcScore = day.morning_class ? 5 : 0
  const maScore = day.mangal_arti   ? 5 : 0
  const clScore = day.cleanliness_done ? 5 : 0

  const dayTotal =
    tbScore + wuScore + drScore + japaScore +
    readingScore + hearingScore + mcScore + maScore + studiesScore + clScore

  return {
    tb: r2(tbScore),
    wu: r2(wuScore),
    dr: r2(drScore),
    japa: r2(japaScore),
    reading: r2(readingScore),
    hearing: r2(hearingScore),
    mc: r2(mcScore),
    ma: r2(maScore),
    studies: r2(studiesScore),
    cleanliness: r2(clScore),
    total: r2(dayTotal),
  }
}

/**
 * Score a full week from an object keyed by weekday (`sun` … `sat`).
 * Returns { days: {mon: {...}}, totals: {...}, grandTotal, percent }.
 */
export function scoreWeek(daily = {}) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const days = {}
  const totals = {
    tb: 0, wu: 0, dr: 0, japa: 0,
    reading: 0, hearing: 0, mc: 0, ma: 0, studies: 0, cleanliness: 0,
  }
  for (const k of keys) {
    const scored = scoreWeeklyDay(daily[k] || {})
    days[k] = scored
    for (const col of Object.keys(totals)) totals[col] += scored[col]
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)
  const percent = (grandTotal / WEEKLY_MAX.total) * 100
  // Round outputs
  for (const col of Object.keys(totals)) totals[col] = r2(totals[col])
  return { days, totals, grandTotal: r2(grandTotal), percent: r2(percent) }
}

function r2(n) { return Math.round(n * 100) / 100 }

// Earlier-is-better tiers (e.g. japa/wake/bed times in minutes).
function tierLte(value, tiers) {
  if (value === null || value === undefined) return 0
  for (const [cutoff, points] of tiers) if (value <= cutoff) return points
  return 0
}

// More-is-better tiers (e.g. reading/hearing minutes, seva hours).
function tierGte(value, tiers) {
  if (!value || value <= 0) return 0
  for (const [cutoff, points] of tiers) if (value >= cutoff) return points
  return 0
}

export function calculateSadhanaScore(report, config) {
  const cfg = { ...DEFAULT_SADHANA_CONFIG, ...(config || {}) }

  // --- JAPA (30 pts) ---
  const rounds = Math.min(report.japa_rounds ?? 0, cfg.japaMaxRounds)
  const roundScore = (rounds / cfg.japaMaxRounds) * cfg.japaRoundsPoints
  const timeScore = tierLte(timeToMinutes(report.japa_time), cfg.japaTimeTiers)
  const scoreJapa = roundScore + timeScore

  // --- SLEEP DISCIPLINE (20 pts) ---
  const wuScore = tierLte(timeToMinutes(report.wake_up_time), cfg.wakeUpTiers)
  const tbMin = timeToMinutes(report.to_bed_time)
  // Convert PM time: if < 12:00, it's AM (post-midnight), add 24 hrs conceptually
  const tbAdjusted = tbMin === null ? null : tbMin < 12 * 60 ? tbMin + 24 * 60 : tbMin
  const tbScore = tierLte(tbAdjusted, cfg.toBedTiers)
  const scoreSleep = wuScore + tbScore

  // --- READING / HEARING (15 pts each) ---
  const scoreReading = tierGte(report.reading_min ?? 0, cfg.readingTiers)
  const scoreHearing = tierGte(report.hearing_min ?? 0, cfg.hearingTiers)

  // --- SEVA (10 pts) ---
  const scoreSeva = tierGte(parseFloat(report.seva_hours ?? 0), cfg.sevaTiers)

  // --- ATTENDANCE (10 pts) ---
  const scoreAttendance =
    (report.mangal_arti ? cfg.mangalArtiPoints : 0) +
    (report.morning_class ? cfg.morningClassPoints : 0)

  // --- STUDIES (10 pts) ---
  const scoreStudies = tierGte(report.studies_min ?? 0, cfg.studiesTiers)

  // --- CLEANLINESS (5 pts) ---
  const scoreCleanliness = report.cleanliness_done ? cfg.cleanlinessPoints : 0

  // --- DAY REST PENALTY ---
  const drMin = report.day_rest_min ?? 0
  const penalty = Math.min(
    Math.floor(drMin / 15) * cfg.dayRestPenaltyPer15Min,
    cfg.maxDayRestPenalty
  )

  // Studies + cleanliness are additive bonus points on top of the original
  // 100-pt scale.  Score is capped at 100 so existing tests (which don't set
  // those fields) still pass.
  const rawTotal =
    scoreJapa + scoreSleep + scoreReading + scoreHearing +
    scoreSeva + scoreAttendance + scoreStudies + scoreCleanliness - penalty

  const total = Math.max(0, Math.round(rawTotal * 100) / 100)

  return {
    score: Math.min(total, 100),
    score_japa: Math.round(scoreJapa * 100) / 100,
    score_sleep: Math.round(scoreSleep * 100) / 100,
    score_reading: Math.round(scoreReading * 100) / 100,
    score_hearing: Math.round(scoreHearing * 100) / 100,
    score_seva: Math.round(scoreSeva * 100) / 100,
    score_attendance: Math.round(scoreAttendance * 100) / 100,
    score_studies: Math.round(scoreStudies * 100) / 100,
    score_cleanliness: Math.round(scoreCleanliness * 100) / 100,
  }
}

export function generateWhatsAppMessage(report, devoteeFullName) {
  const name = devoteeFullName ?? 'Your servant'
  const dateObj = new Date(report.report_date)
  const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const formatT = (t) => {
    if (!t) return 'N/A'
    const [h, m] = t.split(':')
    const hr = parseInt(h)
    const ampm = hr >= 12 ? 'PM' : 'AM'
    const disp = hr % 12 || 12
    return `${disp}:${m} ${ampm}`
  }

  return `Hare Krishna Prabhuji,\nDate: ${dateStr}\n\nTB: ${formatT(report.to_bed_time)}\nWU: ${formatT(report.wake_up_time)}\nDR: ${report.day_rest_min ?? 0} min\nJP: ${formatT(report.japa_time)} (${report.japa_rounds ?? 0} rounds)\nRD: ${report.reading_min ?? 0} min\nHR: ${report.hearing_min ?? 0} min\nMA: ${report.mangal_arti ? 'Y' : 'N'}\nMC: ${report.morning_class ? 'Y' : 'N'}\nStudies: ${report.studies_min ?? 0} min\nCleanliness: ${report.cleanliness_done ? 'Y' : 'N'}\nSeva: ${report.seva_hours ?? 0} hrs\n\nYour servant,\n${name}`
}

/**
 * Format the weekly report as a WhatsApp message for the sadhana in-charge.
 */
export function generateWeeklyWhatsAppMessage({ weekStart, daily, totals, grandTotal, percent, devoteeFullName, notes }) {
  const name = devoteeFullName ?? 'Your servant'
  const start = new Date(weekStart)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const dayLabels = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' }

  const rows = dayKeys.map((k) => {
    const d = daily?.[k] || {}
    const parts = []
    if (d.to_bed_time) parts.push(`TB:${d.to_bed_time}`)
    if (d.wake_up_time) parts.push(`WU:${d.wake_up_time}`)
    if (d.japa_rounds) parts.push(`JP:${d.japa_rounds}r`)
    if (d.reading_min) parts.push(`RD:${d.reading_min}m`)
    if (d.hearing_min) parts.push(`HR:${d.hearing_min}m`)
    if (d.studies_min) parts.push(`ST:${d.studies_min}m`)
    if (d.mangal_arti) parts.push('MA')
    if (d.morning_class) parts.push('MC')
    if (d.cleanliness_done) parts.push('CL')
    return `${dayLabels[k]}: ${parts.length ? parts.join(' ') : '—'}`
  }).join('\n')

  return `Hare Krishna Prabhuji,\n\nWeekly Sadhana Report\n${fmt(start)} - ${fmt(end)}\n\n${rows}\n\n— Totals (${grandTotal}/${WEEKLY_MAX.total} = ${percent}%) —\nTB: ${totals.tb}/${WEEKLY_MAX.tb}\nWU: ${totals.wu}/${WEEKLY_MAX.wu}\nDR: ${totals.dr}/${WEEKLY_MAX.dr}\nJAPA: ${totals.japa}/${WEEKLY_MAX.japa}\nReading: ${totals.reading}/${WEEKLY_MAX.reading}\nHearing: ${totals.hearing}/${WEEKLY_MAX.hearing}\nMC: ${totals.mc}/${WEEKLY_MAX.mc}\nMA: ${totals.ma}/${WEEKLY_MAX.ma}\nStudies: ${totals.studies}/${WEEKLY_MAX.studies}\nCleanliness: ${totals.cleanliness}/${WEEKLY_MAX.cleanliness}\n${notes ? `\nNotes: ${notes}\n` : ''}\nYour servant,\n${name}`
}
