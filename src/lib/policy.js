/**
 * policy.js
 * Pure policy resolution for the child device. No I/O, no Capacitor, no
 * Supabase — every function here is deterministic and unit-testable with
 * `node --test`, which is what lets us prove the block/unblock logic is
 * correct without an emulator in the loop.
 *
 * The enforcement pipeline is:
 *
 *   DB rows ──► resolvePolicy()  ──► desired state {blockList, allowList}
 *                                        │
 *   applied state (persisted) ───────────┤
 *                                        ▼
 *                                 diffSuspension()
 *                                        │
 *                                        ▼
 *                          {toSuspend, toUnsuspend} ──► native DPC calls
 *
 * Separating "what should be true" (resolvePolicy) from "what must change"
 * (diffSuspension) is the fix for the class of bug where deleting a rule
 * left an app suspended forever: the reconciler always drives the device
 * toward the desired state, it never assumes the previous action stuck.
 */

// ── Lockout protection ───────────────────────────────────────────────
// Mirrors pc_is_protected_package() in supabase/61_policy_integrity.sql.
// Duplicated deliberately: the database is the authority, but the device
// must also refuse locally so a legacy row written before migration 61,
// or a corrupted cache, can never suspend the emergency dialer.
export const PROTECTED_PACKAGES = Object.freeze([
  // Emergency + telephony
  'com.android.server.telecom',
  'com.android.phone',
  'com.android.dialer',
  'com.google.android.dialer',
  'com.android.emergency',
  'com.android.incallui',
  // Core system surfaces
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.providers.settings',
  // Launchers
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  // The agent itself — suspending it makes the device unmanageable
  'com.surabhikunj.voice.kids',
])

const PROTECTED_SET = new Set(PROTECTED_PACKAGES)

export function isProtectedPackage(pkg) {
  return PROTECTED_SET.has(pkg)
}

// ── Time helpers ─────────────────────────────────────────────────────

/** Minutes since local midnight for a Date. */
export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Parses "HH:MM" or "HH:MM:SS" into minutes since midnight.
 * Returns null for anything unparseable so callers can skip the rule
 * rather than treating a malformed schedule as "always active".
 */
export function parseHm(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Is `nowMin` inside [start, end)? Handles windows that cross midnight
 * (e.g. bedtime 22:00 → 06:30).
 *
 * The end bound is exclusive so a 22:00-06:30 bedtime releases exactly at
 * 06:30 instead of lingering for one extra minute.
 */
export function isTimeInRange(start, end, nowMin) {
  const s = parseHm(start)
  const e = parseHm(end)
  if (s === null || e === null) return false
  if (s === e) return false // zero-length window is never active
  if (e < s) return nowMin >= s || nowMin < e // crosses midnight
  return nowMin >= s && nowMin < e
}

export function isScheduleActive(schedule, now = new Date()) {
  if (!schedule || schedule.is_enabled === false) return false
  const days = schedule.days_of_week
  if (!Array.isArray(days) || !days.includes(now.getDay())) return false
  return isTimeInRange(schedule.start_time, schedule.end_time, minutesOfDay(now))
}

/**
 * Picks the schedule to enforce right now.
 *
 * Conflict resolution (documented priority order — see ARCHITECTURE.md):
 *   1. Bonus time granted by a parent suspends ALL schedules. An explicit,
 *      time-boxed parental override must win over a standing rule.
 *   2. Otherwise the most restrictive active schedule wins:
 *        block_all > allow_list_only > block_internet
 *      Restrictiveness beats recency so two overlapping schedules can
 *      never leave the device less restricted than the parent intended.
 *   3. Ties broken by id for determinism.
 */
const SCHEDULE_SEVERITY = { block_all: 3, allow_list_only: 2, block_internet: 1 }

export function findActiveSchedule(schedules, now = new Date(), { bonusActive = false } = {}) {
  if (bonusActive) return null
  const active = (schedules ?? []).filter((s) => isScheduleActive(s, now))
  if (active.length === 0) return null
  return active.sort((a, b) => {
    const sev = (SCHEDULE_SEVERITY[b.action] ?? 0) - (SCHEDULE_SEVERITY[a.action] ?? 0)
    if (sev !== 0) return sev
    return String(a.id).localeCompare(String(b.id))
  })[0]
}

// ── Policy resolution ────────────────────────────────────────────────

/**
 * Computes the complete desired enforcement state from raw DB rows.
 *
 * @param {object}   input
 * @param {Array}    input.schedules        pc_schedules rows
 * @param {Array}    input.rules            pc_app_rules rows
 * @param {object}   input.usageByPackage   { [packageName]: foregroundMs } for today
 * @param {boolean}  input.usageAvailable   false when Usage Access is not granted
 * @param {boolean}  input.bonusActive      parent-granted bonus time in effect
 * @param {Date}     input.now
 *
 * @returns {{
 *   activeSchedule: object|null,
 *   blockList: string[],
 *   allowList: string[],
 *   limitStatus: Array<{packageName, usedMin, limitMin, exceeded}>,
 *   skipped: Array<{packageName, reason}>
 * }}
 *
 * Guarantees:
 *   • blockList never contains a protected package.
 *   • blockList and allowList are deduplicated and sorted, so the same
 *     policy always produces a byte-identical signature.
 *   • A time_limit rule is inert when usage data is unavailable, rather
 *     than defaulting to "blocked" — failing closed here would lock a
 *     child out of every limited app the moment Usage Access is revoked.
 */
export function resolvePolicy({
  schedules = [],
  rules = [],
  usageByPackage = {},
  usageAvailable = true,
  bonusActive = false,
  now = new Date(),
} = {}) {
  const activeSchedule = findActiveSchedule(schedules, now, { bonusActive })

  const blockSet = new Set()
  const allowSet = new Set()
  const limitStatus = []
  const skipped = []

  for (const rule of rules) {
    if (!rule || rule.is_enabled === false) continue
    const pkg = rule.package_name
    if (!pkg) continue

    if (rule.action === 'allow') {
      allowSet.add(pkg)
      continue
    }

    if (isProtectedPackage(pkg)) {
      // Defense in depth: migration 61 rejects these at write time, but a
      // row created before it, or a stale cache, must still be ignored.
      skipped.push({ packageName: pkg, reason: 'protected_package' })
      continue
    }

    if (rule.action === 'block') {
      blockSet.add(pkg)
      continue
    }

    if (rule.action === 'time_limit') {
      const limitMin = Number(rule.daily_limit_min)
      if (!Number.isFinite(limitMin) || limitMin <= 0) {
        skipped.push({ packageName: pkg, reason: 'invalid_limit' })
        continue
      }
      if (!usageAvailable) {
        skipped.push({ packageName: pkg, reason: 'no_usage_access' })
        continue
      }
      if (bonusActive) {
        skipped.push({ packageName: pkg, reason: 'bonus_active' })
        continue
      }
      const usedMin = Math.floor((usageByPackage[pkg] ?? 0) / 60_000)
      const exceeded = usedMin >= limitMin
      limitStatus.push({ packageName: pkg, usedMin, limitMin, exceeded })
      if (exceeded) blockSet.add(pkg)
    }
  }

  // An explicit 'allow' rule overrides a 'block' on the same package —
  // the parent added the allow later and more specifically.
  for (const pkg of allowSet) blockSet.delete(pkg)

  return {
    activeSchedule: activeSchedule ?? null,
    blockList: [...blockSet].sort(),
    allowList: [...allowSet].sort(),
    limitStatus: limitStatus.sort((a, b) => a.packageName.localeCompare(b.packageName)),
    skipped,
  }
}

// ── Reconciliation ───────────────────────────────────────────────────

/**
 * Works out the minimal set of native calls needed to move the device from
 * `applied` (what we previously suspended, persisted across restarts) to
 * `desired` (what resolvePolicy just computed).
 *
 * @param {string[]} applied            packages we believe are suspended
 * @param {string[]} desired            packages that should be suspended
 * @param {string[]|null} installed     full installed-package list, when known
 *
 * When `installed` is supplied we also unsuspend anything in that list that
 * is NOT desired — a full authoritative reconcile. That heals devices whose
 * applied-state cache was lost (app data cleared, reinstall, migration from
 * an older build) and is the reason a deleted rule now reliably unblocks.
 *
 * Returns sorted arrays so the result is stable and easy to assert on.
 */
export function diffSuspension(applied = [], desired = [], installed = null) {
  const desiredSet = new Set(desired.filter((p) => p && !isProtectedPackage(p)))
  const appliedSet = new Set(applied ?? [])

  const toSuspend = [...desiredSet].filter((p) => !appliedSet.has(p))

  const releaseCandidates = new Set(appliedSet)
  if (Array.isArray(installed)) {
    for (const pkg of installed) releaseCandidates.add(pkg)
  }

  const toUnsuspend = [...releaseCandidates].filter(
    (p) => p && !desiredSet.has(p) && !isProtectedPackage(p),
  )

  return {
    toSuspend: toSuspend.sort(),
    toUnsuspend: toUnsuspend.sort(),
    // The applied-state we should persist once the calls succeed.
    nextApplied: [...desiredSet].sort(),
  }
}

/**
 * Stable fingerprint of a resolved policy. Used to skip redundant native
 * work — but note the caller must ALSO reconcile whenever the applied-state
 * differs from desired, otherwise an unchanged policy would never repair a
 * device that drifted (e.g. the user manually un-suspended an app).
 */
export function policySignature(resolved, policyVersion = null) {
  return JSON.stringify({
    v: policyVersion ?? null,
    s: resolved?.activeSchedule?.id ?? null,
    a: resolved?.activeSchedule?.action ?? null,
    b: resolved?.blockList ?? [],
    w: resolved?.allowList ?? [],
  })
}

/** Converts the native getTodayUsage() shape into a { pkg: ms } map. */
export function usageMapFromApps(apps = []) {
  const map = {}
  for (const app of apps) {
    if (!app?.packageName) continue
    map[app.packageName] = (map[app.packageName] ?? 0) + (app.totalForegroundMs ?? 0)
  }
  return map
}
