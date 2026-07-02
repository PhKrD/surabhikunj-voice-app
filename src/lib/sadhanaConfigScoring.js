/**
 * Dynamic Sadhana Scoring Engine
 * Uses admin-configured scoring rules from the database
 */

function timeToMinutes(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/**
 * Apply time-based scoring (before cutoff gets points)
 * @param {string} time - Time in HH:MM format
 * @param {Array} cutoffs - Array of {time, points} sorted by time ascending
 * @param {number} penaltyAfter - Points if after all cutoffs
 */
function scoreTimeBefore(time, cutoffs, penaltyAfter = 0) {
  const minutes = timeToMinutes(time)
  if (minutes === null) return 0
  
  for (const cutoff of cutoffs) {
    const cutoffMin = timeToMinutes(cutoff.time)
    if (minutes <= cutoffMin) return cutoff.points
  }
  return penaltyAfter
}

/**
 * Apply time-based scoring (after cutoff gets points - for bedtime)
 * Earlier times get higher points
 * @param {string} time - Time in HH:MM format
 * @param {Array} cutoffs - Array of {time, points} sorted by time ascending
 * @param {number} penaltyAfter - Points if after all cutoffs
 */
function scoreTimeAfter(time, cutoffs, penaltyAfter = 0) {
  const minutes = timeToMinutes(time)
  if (minutes === null) return 0
  
  // Handle post-midnight times (0:00-6:00) as late night
  const adjustedMinutes = minutes < 6 * 60 ? minutes + 24 * 60 : minutes
  
  for (const cutoff of cutoffs) {
    const cutoffMin = timeToMinutes(cutoff.time)
    if (adjustedMinutes <= cutoffMin) return cutoff.points
  }
  return penaltyAfter
}

/**
 * Apply duration-based scoring (more is better)
 * @param {number} minutes - Duration in minutes
 * @param {Array} tiers - Array of {minutes, points} sorted descending
 */
function scoreDuration(minutes, tiers) {
  if (!minutes || minutes <= 0) return 0
  
  for (const tier of tiers) {
    if (minutes >= tier.minutes) return tier.points
  }
  return 0
}

/**
 * Apply penalty-based duration scoring (for day rest)
 * @param {number} minutes - Duration in minutes
 * @param {Array} penaltyTiers - Array of {minutes, points} where points are negative
 */
function scorePenaltyDuration(minutes, penaltyTiers) {
  if (!minutes || minutes <= 0) return 0
  
  // Find the appropriate penalty
  for (const tier of penaltyTiers) {
    if (minutes >= tier.minutes) return tier.points
  }
  return 0
}

/**
 * Apply rounds-based scoring
 * @param {number} rounds - Number of rounds
 * @param {Array} tiers - Array of {rounds, points}
 */
function scoreRounds(rounds, tiers) {
  if (!rounds || rounds <= 0) return 0
  
  for (const tier of tiers) {
    if (rounds >= tier.rounds) return tier.points
  }
  return 0
}

/**
 * Apply seva hours scoring
 * @param {number} hours - Seva hours
 * @param {Array} tiers - Array of {hours, points}
 */
function scoreSevaHours(hours, tiers) {
  if (!hours || hours <= 0) return 0
  
  for (const tier of tiers) {
    if (hours >= tier.hours) return tier.points
  }
  return 0
}

/**
 * Apply boolean scoring
 * @param {boolean} value - True/false value
 * @param {number} pointsIfTrue - Points awarded if true
 */
function scoreBoolean(value, pointsIfTrue) {
  return value ? pointsIfTrue : 0
}

/**
 * Calculate sadhana score using dynamic configuration
 * @param {Object} report - Sadhana report data
 * @param {Array} scoringRules - Array of scoring rules from database
 * @returns {Object} Score breakdown
 */
export function calculateDynamicSadhanaScore(report, scoringRules) {
  if (!scoringRules || scoringRules.length === 0) {
    // Fallback to hardcoded defaults if no rules configured
    return calculateFallbackScore(report)
  }
  
  const scores = {}
  let total = 0
  
  // Process each scoring rule
  for (const rule of scoringRules) {
    if (!rule.is_active) continue
    
    let score = 0
    const config = rule.config || {}
    
    switch (rule.rule_type) {
      case 'time_before':
        if (rule.parameter === 'wu') {
          score = scoreTimeBefore(report.wake_up_time, config.cutoffs || [], config.penalty_after || 0)
        } else if (rule.parameter === 'japa_time' || rule.parameter === 'japa_rounds') {
          // japa_rounds now uses time-based scoring for completion time
          score = scoreTimeBefore(report.japa_time, config.cutoffs || [], config.penalty_after || 0)
        }
        break
        
      case 'time_after':
        if (rule.parameter === 'tb') {
          score = scoreTimeAfter(report.to_bed_time, config.cutoffs || [], config.penalty_after || 0)
        }
        break
        
      case 'duration_min':
        if (rule.parameter === 'reading') {
          score = scoreDuration(report.reading_min, config.tiers || [])
        } else if (rule.parameter === 'hearing') {
          score = scoreDuration(report.hearing_min, config.tiers || [])
        } else if (rule.parameter === 'studies') {
          score = scoreDuration(report.studies_min, config.tiers || [])
        } else if (rule.parameter === 'dr') {
          score = scorePenaltyDuration(report.day_rest_min, config.penalty_tiers || [])
        }
        break
        
      case 'rounds':
        // Legacy support - japa_rounds is now time-based
        if (rule.parameter === 'japa_rounds') {
          // Use time-based scoring for japa completion instead of rounds count
          score = scoreTimeBefore(report.japa_time, config.cutoffs || [
            {time: '06:00', points: 15},
            {time: '07:00', points: 11},
            {time: '08:00', points: 7},
            {time: '09:00', points: 4}
          ], 0)
        }
        break
        
      case 'seva_hours':
        score = scoreSevaHours(report.seva_hours, config.tiers || [])
        break
        
      case 'boolean':
        if (rule.parameter === 'ma') {
          score = scoreBoolean(report.mangal_arti, config.points_if_true || 0)
        } else if (rule.parameter === 'mc') {
          score = scoreBoolean(report.morning_class, config.points_if_true || 0)
        } else if (rule.parameter === 'cleanliness') {
          score = scoreBoolean(report.cleanliness_done, config.points_if_true || 0)
        }
        break
    }
    
    // Cap at max points for this parameter (except penalties)
    if (score > 0) {
      score = Math.min(score, rule.max_points)
    }
    
    scores[`score_${rule.parameter}`] = Math.round(score * 100) / 100
    total += score
  }
  
  // Combine japa rounds and time scores if both exist
  if (scores.score_japa_rounds !== undefined && scores.score_japa_time !== undefined) {
    scores.score_japa = scores.score_japa_rounds + scores.score_japa_time
    delete scores.score_japa_rounds
    delete scores.score_japa_time
  }
  
  // Combine TB and WU into sleep score
  if (scores.score_tb !== undefined && scores.score_wu !== undefined) {
    scores.score_sleep = scores.score_tb + scores.score_wu
    delete scores.score_tb
    delete scores.score_wu
  }
  
  // Combine MA and MC into attendance score
  if (scores.score_ma !== undefined && scores.score_mc !== undefined) {
    scores.score_attendance = scores.score_ma + scores.score_mc
    delete scores.score_ma
    delete scores.score_mc
  }
  
  return {
    ...scores,
    score: Math.max(0, Math.round(total * 100) / 100)
  }
}

/**
 * Fallback scoring using hardcoded defaults
 */
function calculateFallbackScore(report) {
  // Use the existing scoring logic from sadhanaScoring.js as fallback
  const scores = {
    score_japa: 0,
    score_sleep: 0,
    score_reading: 0,
    score_hearing: 0,
    score_seva: 0,
    score_attendance: 0,
    score_studies: 0,
    score_cleanliness: 0
  }
  
  // Japa scoring (25 points max)
  const rounds = Math.min(report.japa_rounds ?? 0, 16)
  scores.score_japa += (rounds / 16) * 15
  const japaMin = timeToMinutes(report.japa_time)
  if (japaMin !== null) {
    if (japaMin <= 7 * 60) scores.score_japa += 10
    else if (japaMin <= 8 * 60) scores.score_japa += 7
    else if (japaMin <= 9 * 60) scores.score_japa += 5
    else if (japaMin <= 10 * 60) scores.score_japa += 3
  }
  
  // Sleep scoring (20 points max)
  const wuMin = timeToMinutes(report.wake_up_time)
  if (wuMin !== null) {
    if (wuMin <= 4 * 60 + 30) scores.score_sleep += 10
    else if (wuMin <= 5 * 60) scores.score_sleep += 8
    else if (wuMin <= 5 * 60 + 30) scores.score_sleep += 5
    else if (wuMin <= 6 * 60) scores.score_sleep += 2
  }
  const tbMin = timeToMinutes(report.to_bed_time)
  if (tbMin !== null) {
    const tbAdjusted = tbMin < 12 * 60 ? tbMin + 24 * 60 : tbMin
    if (tbAdjusted <= 22 * 60) scores.score_sleep += 10
    else if (tbAdjusted <= 22 * 60 + 30) scores.score_sleep += 8
    else if (tbAdjusted <= 23 * 60) scores.score_sleep += 5
    else if (tbAdjusted <= 23 * 60 + 30) scores.score_sleep += 2
  }
  
  // Reading scoring (15 points max)
  const readMin = report.reading_min ?? 0
  if (readMin >= 60) scores.score_reading = 15
  else if (readMin >= 45) scores.score_reading = 12
  else if (readMin >= 30) scores.score_reading = 9
  else if (readMin >= 15) scores.score_reading = 5
  else if (readMin > 0) scores.score_reading = 2
  
  // Hearing scoring (15 points max)
  const hearMin = report.hearing_min ?? 0
  if (hearMin >= 60) scores.score_hearing = 15
  else if (hearMin >= 45) scores.score_hearing = 12
  else if (hearMin >= 30) scores.score_hearing = 9
  else if (hearMin >= 15) scores.score_hearing = 5
  else if (hearMin > 0) scores.score_hearing = 2
  
  // Seva scoring (10 points max)
  const sevaHrs = parseFloat(report.seva_hours ?? 0)
  if (sevaHrs >= 4) scores.score_seva = 10
  else if (sevaHrs >= 3) scores.score_seva = 8
  else if (sevaHrs >= 2) scores.score_seva = 6
  else if (sevaHrs >= 1) scores.score_seva = 3
  else if (sevaHrs > 0) scores.score_seva = 1
  
  // Attendance scoring (10 points max)
  scores.score_attendance = (report.mangal_arti ? 5 : 0) + (report.morning_class ? 5 : 0)
  
  // Studies scoring (10 points max)
  const studyMin = report.studies_min ?? 0
  if (studyMin >= 60) scores.score_studies = 10
  else if (studyMin >= 45) scores.score_studies = 8
  else if (studyMin >= 30) scores.score_studies = 6
  else if (studyMin >= 15) scores.score_studies = 3
  else if (studyMin > 0) scores.score_studies = 1
  
  // Cleanliness scoring (5 points max)
  scores.score_cleanliness = report.cleanliness_done ? 5 : 0
  
  // Day rest penalty
  const drMin = report.day_rest_min ?? 0
  const penalty = Math.min(Math.floor(drMin / 15) * 0.5, 5)
  
  const total = Object.values(scores).reduce((sum, val) => sum + val, 0) - penalty
  
  return {
    ...scores,
    score: Math.max(0, Math.min(100, Math.round(total * 100) / 100))
  }
}

/**
 * Format scoring rules for display in admin UI
 */
export function formatScoringRule(rule) {
  const config = rule.config || {}
  
  switch (rule.rule_type) {
    case 'time_before':
    case 'time_after':
      return config.cutoffs?.map(c => `${c.time} → ${c.points} pts`).join(', ') || 'Not configured'
      
    case 'duration_min':
      if (config.penalty_tiers) {
        return config.penalty_tiers?.map(t => `${t.minutes}+ min → ${t.points} pts`).join(', ') || 'Not configured'
      }
      return config.tiers?.map(t => `${t.minutes}+ min → ${t.points} pts`).join(', ') || 'Not configured'
      
    case 'rounds':
      return config.tiers?.map(t => `${t.rounds}+ rounds → ${t.points} pts`).join(', ') || 'Not configured'
      
    case 'seva_hours':
      return config.tiers?.map(t => `${t.hours}+ hrs → ${t.points} pts`).join(', ') || 'Not configured'
      
    case 'boolean':
      return `Yes → ${config.points_if_true || 0} pts`
      
    default:
      return 'Custom configuration'
  }
}
