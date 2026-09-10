/**
 * screenTimePolicy.js
 * Pure, dependency-free decision logic for the Qustodio-style "daily time
 * limits" and "restricted times" features (supabase/70_qustodio_parity.sql).
 *
 * Mirrored 1:1 in android/.../dpc/PolicyEnforcer.kt (the authoritative
 * on-device enforcer). Keep the two in sync — the JS copy exists so the
 * parent UI can preview "what will the device do right now" and so the
 * logic is unit-testable with `node --test`.
 */

// Packages whose foreground time is NOT "screen time" from the child's
// point of view: the launcher, system UI, and the supervision app itself
// (a child staring at the "Time's up" screen must not burn more time).
export const SCREEN_TIME_EXCLUDED_PACKAGES = Object.freeze([
  'android',
  'com.android.systemui',
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  'com.surabhikunj.voice',
])

const EXCLUDED = new Set(SCREEN_TIME_EXCLUDED_PACKAGES)

export const LIMIT_ACTIONS = Object.freeze(['lock_navigation', 'lock_device', 'alert_only'])
export const RESTRICTED_ACTIONS = Object.freeze(['lock_navigation', 'lock_device', 'block_internet'])

/** Total foreground ms across apps, excluding launcher/system UI/VOICE itself. */
export function totalScreenTimeMs(usageByPackage = {}) {
  let total = 0
  for (const [pkg, ms] of Object.entries(usageByPackage)) {
    if (EXCLUDED.has(pkg)) continue
    const n = Number(ms)
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}

/**
 * Today's limit in minutes for a pc_screen_time_rules row, honouring the
 * per-weekday override. Returns null when there is effectively no limit
 * (rule disabled / missing / negative). 0 is a real limit ("no screen
 * time today").
 */
export function limitForDay(rule, dow) {
  if (!rule || rule.is_enabled === false) return null
  const byDow = rule.daily_limits_by_dow
  if (byDow && typeof byDow === 'object') {
    const v = byDow[String(dow)]
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  const base = Number(rule.daily_limit_min)
  if (!Number.isFinite(base) || base < 0) return null
  return base
}

/** Per-app variant of limitForDay for pc_app_rules time_limit rows (no is_enabled short-circuit — the caller already filtered). */
export function appLimitForDay(rule, dow) {
  if (!rule) return null
  const byDow = rule.daily_limits_by_dow
  if (byDow && typeof byDow === 'object') {
    const v = byDow[String(dow)]
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  const base = Number(rule.daily_limit_min)
  if (!Number.isFinite(base) || base <= 0) return null
  return base
}

/**
 * Normalizes pc_restricted_times.cells ({"0": [22, 23, ...], ...}) into a
 * Set of "dow:hour" keys. Tolerates junk (non-arrays, out-of-range hours).
 */
export function restrictedCellSet(cells) {
  const set = new Set()
  if (!cells || typeof cells !== 'object') return set
  for (const [dow, hours] of Object.entries(cells)) {
    const d = Number(dow)
    if (!Number.isInteger(d) || d < 0 || d > 6 || !Array.isArray(hours)) continue
    for (const h of hours) {
      const hour = Number(h)
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) set.add(`${d}:${hour}`)
    }
  }
  return set
}

/** Inverse of restrictedCellSet — back to the JSONB shape, hours sorted. */
export function cellsFromSet(set) {
  const out = {}
  for (const key of set) {
    const [d, h] = key.split(':').map(Number)
    if (!out[d]) out[d] = []
    out[d].push(h)
  }
  for (const d of Object.keys(out)) out[d].sort((a, b) => a - b)
  return out
}

/** True when `now` falls inside a restricted-hour cell. */
export function isRestrictedNow(restricted, now = new Date()) {
  if (!restricted || restricted.is_enabled === false) return false
  const set = restricted._set ?? restrictedCellSet(restricted.cells)
  return set.has(`${now.getDay()}:${now.getHours()}`)
}

/**
 * Combines everything that can lock the whole device into one answer.
 *
 * Priority (most explicit parental intent first):
 *   1. bonus time  -> never locked (parent granted an explicit override)
 *   2. active schedule (block_all / allow_list_only handled by the caller —
 *      this helper only reports it so the UI can label the lock)
 *   3. restricted-time grid cell
 *   4. daily limit reached
 *
 * @returns {{ locked: boolean, reason: null|'schedule'|'restricted_time'|'daily_limit',
 *             action: null|string, usedMin: number, limitMin: number|null, remainingMin: number|null }}
 */
export function resolveLockState({
  rule = null,
  restricted = null,
  activeSchedule = null,
  usageByPackage = {},
  usageAvailable = true,
  bonusActive = false,
  now = new Date(),
} = {}) {
  const usedMin = Math.floor(totalScreenTimeMs(usageByPackage) / 60_000)
  const limitMin = limitForDay(rule, now.getDay())
  const remainingMin = limitMin === null ? null : Math.max(0, limitMin - usedMin)

  if (bonusActive) return { locked: false, reason: null, action: null, usedMin, limitMin, remainingMin }

  if (activeSchedule && (activeSchedule.action === 'block_all' || activeSchedule.action === 'allow_list_only')) {
    return { locked: true, reason: 'schedule', action: activeSchedule.action, usedMin, limitMin, remainingMin }
  }

  if (isRestrictedNow(restricted, now)) {
    const action = RESTRICTED_ACTIONS.includes(restricted.action) ? restricted.action : 'lock_navigation'
    // block_internet is not a device lock — the caller pauses internet instead.
    return { locked: action !== 'block_internet', reason: 'restricted_time', action, usedMin, limitMin, remainingMin }
  }

  if (limitMin !== null && usageAvailable && usedMin >= limitMin) {
    const action = LIMIT_ACTIONS.includes(rule?.limit_action) ? rule.limit_action : 'lock_navigation'
    return { locked: action !== 'alert_only', reason: 'daily_limit', action, usedMin, limitMin, remainingMin }
  }

  return { locked: false, reason: null, action: null, usedMin, limitMin, remainingMin }
}

export const LOCK_REASON_COPY = Object.freeze({
  daily_limit: {
    title: "Time's up for today",
    body: "You've used all of today's screen time. You can ask your parents for a bit more.",
  },
  restricted_time: {
    title: 'Not now',
    body: 'This is a restricted time set by your parents. Come back when it ends.',
  },
  schedule: {
    title: 'Screen time paused',
    body: 'Your parents have scheduled a break. Come back later or ask for more time.',
  },
  parent_lock: {
    title: 'Locked by your parents',
    body: 'Your parents locked this device for now.',
  },
})

/** Formats minutes as "2h 05m" / "45m". */
export function formatMinutes(min) {
  const n = Math.max(0, Math.round(Number(min) || 0))
  const h = Math.floor(n / 60)
  const m = n % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}
