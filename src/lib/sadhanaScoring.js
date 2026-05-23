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

export function calculateSadhanaScore(report) {
  let scoreJapa
  let scoreSleep
  let scoreReading
  let scoreHearing
  let scoreSeva
  let scoreAttendance = 0

  // --- JAPA (30 pts) ---
  // Rounds: 0-16 rounds → 0-15 pts (16 rounds = full 15 pts)
  const rounds = Math.min(report.japa_rounds ?? 0, 16)
  const roundScore = (rounds / 16) * 15

  // Time: earlier completion = more pts (0-15 pts)
  let timeScore = 0
  const japaMin = timeToMinutes(report.japa_time)
  if (japaMin !== null) {
    const t7 = 7 * 60        // 07:00
    const t8 = 8 * 60        // 08:00
    const t9 = 9 * 60        // 09:00
    const t10 = 10 * 60      // 10:00
    if (japaMin <= t7) timeScore = 15
    else if (japaMin <= t8) timeScore = 12
    else if (japaMin <= t9) timeScore = 8
    else if (japaMin <= t10) timeScore = 4
    else timeScore = 0
  }
  scoreJapa = roundScore + timeScore

  // --- SLEEP DISCIPLINE (20 pts) ---
  // Wake-up (10 pts): 04:30 or earlier = 10, by 05:00 = 8, by 05:30 = 5, by 06:00 = 2, later = 0
  let wuScore = 0
  const wuMin = timeToMinutes(report.wake_up_time)
  if (wuMin !== null) {
    if (wuMin <= 4 * 60 + 30) wuScore = 10
    else if (wuMin <= 5 * 60) wuScore = 8
    else if (wuMin <= 5 * 60 + 30) wuScore = 5
    else if (wuMin <= 6 * 60) wuScore = 2
    else wuScore = 0
  }

  // To-bed (10 pts): by 22:00 = 10, by 22:30 = 8, by 23:00 = 5, by 23:30 = 2, later = 0
  let tbScore = 0
  const tbMin = timeToMinutes(report.to_bed_time)
  if (tbMin !== null) {
    // Convert PM time: if < 12*60, it's AM (morning), add 24 hrs conceptually
    const adjusted = tbMin < 12 * 60 ? tbMin + 24 * 60 : tbMin
    const t22 = 22 * 60
    const t2230 = 22 * 60 + 30
    const t23 = 23 * 60
    const t2330 = 23 * 60 + 30
    if (adjusted <= t22) tbScore = 10
    else if (adjusted <= t2230) tbScore = 8
    else if (adjusted <= t23) tbScore = 5
    else if (adjusted <= t2330) tbScore = 2
    else tbScore = 0
  }
  scoreSleep = wuScore + tbScore

  // --- READING (15 pts) ---
  const rdMin = report.reading_min ?? 0
  if (rdMin >= 60) scoreReading = 15
  else if (rdMin >= 45) scoreReading = 12
  else if (rdMin >= 30) scoreReading = 9
  else if (rdMin >= 15) scoreReading = 5
  else if (rdMin > 0) scoreReading = 2
  else scoreReading = 0

  // --- HEARING (15 pts) ---
  const hrMin = report.hearing_min ?? 0
  if (hrMin >= 60) scoreHearing = 15
  else if (hrMin >= 45) scoreHearing = 12
  else if (hrMin >= 30) scoreHearing = 9
  else if (hrMin >= 15) scoreHearing = 5
  else if (hrMin > 0) scoreHearing = 2
  else scoreHearing = 0

  // --- SEVA (10 pts) ---
  const sevaHrs = parseFloat(report.seva_hours ?? 0)
  if (sevaHrs >= 4) scoreSeva = 10
  else if (sevaHrs >= 3) scoreSeva = 8
  else if (sevaHrs >= 2) scoreSeva = 6
  else if (sevaHrs >= 1) scoreSeva = 3
  else if (sevaHrs > 0) scoreSeva = 1
  else scoreSeva = 0

  // --- ATTENDANCE (10 pts) ---
  if (report.mangal_arti) scoreAttendance += 5
  if (report.morning_class) scoreAttendance += 5

  // --- DAY REST PENALTY (max -5 pts) ---
  const drMin = report.day_rest_min ?? 0
  const penalty = Math.min(Math.floor(drMin / 15) * 0.5, 5)

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
