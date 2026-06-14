/**
 * Sadhana Score Calculator
 * Total score: 100 points
 * 
 * Distribution:
 *   Japa (time + rounds):  30 pts
 *   Sleep discipline:      20 pts  (wake-up + to-bed)
 *   Reading:               15 pts
 *   Hearing:               15 pts
 *   Seva:                  10 pts
 *   Attendance (MA+MC):    10 pts
 *   Day rest penalty:      -5 pts max
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
}

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

  // --- DAY REST PENALTY ---
  const drMin = report.day_rest_min ?? 0
  const penalty = Math.min(
    Math.floor(drMin / 15) * cfg.dayRestPenaltyPer15Min,
    cfg.maxDayRestPenalty
  )

  const total = Math.max(
    0,
    Math.round(
      (scoreJapa + scoreSleep + scoreReading + scoreHearing + scoreSeva + scoreAttendance - penalty) * 100
    ) / 100
  )

  return {
    score: Math.min(total, 100),
    score_japa: Math.round(scoreJapa * 100) / 100,
    score_sleep: Math.round(scoreSleep * 100) / 100,
    score_reading: Math.round(scoreReading * 100) / 100,
    score_hearing: Math.round(scoreHearing * 100) / 100,
    score_seva: Math.round(scoreSeva * 100) / 100,
    score_attendance: Math.round(scoreAttendance * 100) / 100,
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

  return `Hare Krishna Prabhuji,\nDate: ${dateStr}\n\nTB: ${formatT(report.to_bed_time)}\nWU: ${formatT(report.wake_up_time)}\nDR: ${report.day_rest_min ?? 0} min\nJP: ${formatT(report.japa_time)} (${report.japa_rounds ?? 0} rounds)\nRD: ${report.reading_min ?? 0} min\nHR: ${report.hearing_min ?? 0} min\nMA: ${report.mangal_arti ? 'Y' : 'N'}\nMC: ${report.morning_class ? 'Y' : 'N'}\nSeva: ${report.seva_hours ?? 0} hrs\n\nYour servant,\n${name}`
}
