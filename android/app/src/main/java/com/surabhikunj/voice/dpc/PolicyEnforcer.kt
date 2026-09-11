package com.surabhikunj.voice.dpc

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * PolicyEnforcer — the authoritative on-device policy engine. Native port of
 * src/lib/policy.js (schedules + per-app rules) and
 * src/lib/screenTimePolicy.js (daily time limits + restricted times).
 *
 * WHY THIS EXISTS: enforcement used to live only in the WebView's JS timers,
 * which Android suspends the moment the child leaves the app. This runs on
 * VoiceKidsMonitorService's own cadence (POLICY_ENFORCE_INTERVAL_MS) so
 * bedtime, "time's up", a parent deleting a rule, etc. take effect within
 * seconds regardless of what the WebView is doing.
 *
 * ENFORCEMENT MODEL (no factory reset): every decision here is written into
 * VoiceKidsPrefs as a "desired state" that VoiceKidsAccessibilityService
 * enforces by kicking disallowed foreground apps back to home. Device Admin
 * additionally gives lockNow() (whole-screen lock) and VPN consent gives
 * internet pause. Device Owner (optional Advanced mode) adds a harder
 * OS-level suspend on top — never required. See DpcActions.kt.
 *
 * Keep this in sync with policy.js / screenTimePolicy.js — same protected
 * packages, same schedule-severity order, same lock-priority order
 * (bonus > schedule > restricted time > daily limit), same
 * "allow overrides block" rule.
 */
object PolicyEnforcer {
    private const val TAG = "VoiceKidsPolicy"

    // Mirrors PROTECTED_PACKAGES in src/lib/policy.js / protectedPackages.js
    // and pc_is_protected_package() in supabase/61_policy_integrity.sql +
    // 66_fix_protected_package_name.sql. The agent's OWN package must be
    // here — suspending it would make the device permanently unmanageable.
    private val PROTECTED_PACKAGES = setOf(
        "com.android.server.telecom",
        "com.android.phone",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.android.emergency",
        "com.android.incallui",
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.providers.settings",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.surabhikunj.voice",
    )

    // Mirrors SCREEN_TIME_EXCLUDED_PACKAGES in src/lib/screenTimePolicy.js.
    private val SCREEN_TIME_EXCLUDED = setOf(
        "android",
        "com.android.systemui",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.surabhikunj.voice",
    )

    private val SCHEDULE_SEVERITY = mapOf(
        "block_all" to 3,
        "allow_list_only" to 2,
        "block_internet" to 1,
    )

    /**
     * What is locking the whole device right now, if anything.
     *   key     — stable identity used to detect the TRANSITION into a lock
     *             (hard lockNow() fires once, not every pass)
     *   reason  — "schedule" | "restricted_time" | "daily_limit" (mirrors
     *             screenTimePolicy.js LOCK_REASON_COPY keys); "" for an
     *             internet-only restriction that does not lock apps
     *   action  — block_all | allow_list_only | block_internet |
     *             lock_navigation | lock_device | alert_only
     */
    private data class LockDecision(
        val key: String,
        val reason: String,
        val action: String,
        val label: String,
        val schedule: JSONObject? = null,
    ) {
        val blocksApps: Boolean get() = action in setOf("block_all", "allow_list_only", "lock_navigation", "lock_device")
        val pausesInternet: Boolean get() = action in setOf("block_internet", "lock_navigation", "lock_device")
        val wantsHardLock: Boolean get() = action == "lock_device" || (action == "block_all" && schedule?.optJSONArray("always_allowed_packages")?.let { it.length() == 0 } ?: true)
    }

    /**
     * All server-side policy inputs for one child, fetched together.
     * `schedules`/`rules` are mandatory (a failed fetch aborts the pass);
     * everything else tolerates null so a transient failure on one table —
     * or pc_restricted_times not existing yet before migration 70 — never
     * stops app-rule/schedule enforcement.
     */
    private class PolicyInputs(
        val policyVersion: Long?,
        val schedules: JSONArray,
        val rules: JSONArray,
        val screenTimeRule: JSONObject?,
        val restricted: JSONObject?,
        val websiteRules: JSONArray?,
        val categoryRules: JSONArray?,
        val filterSettings: JSONObject?,
        val fetchedAt: Long,
    )

    @Volatile private var cachedInputs: PolicyInputs? = null

    // Every enforceable table bumps pc_children.policy_version via trigger
    // (61_policy_integrity.sql + 70_qustodio_parity.sql), so one cheap GET
    // per pass tells us whether the other seven fetches are needed at all.
    // The age cap heals anything a missed bump could otherwise hide forever.
    private const val INPUT_CACHE_MAX_AGE_MS = 5 * 60_000L

    private fun loadInputs(context: Context, childId: String): PolicyInputs? {
        // select=* rather than naming columns: parent_pin_hash /
        // protect_settings only exist after migration 71, and PostgREST
        // rejects the whole request for an unknown column, which would
        // take enforcement down entirely on a not-yet-migrated database.
        val childRow = fetchRows(context, "pc_children", "id=eq.$childId&select=*")?.optJSONObject(0)
        if (childRow != null) {
            VoiceKidsPrefs.setParentPinHash(context, childRow.optString("parent_pin_hash", "").takeIf { it.isNotEmpty() && it != "null" })
            VoiceKidsPrefs.setProtectSettings(context, childRow.optBoolean("protect_settings", true))
        }
        val policyVersion = childRow?.optLong("policy_version", -1L)?.takeIf { it >= 0 }
        val cached = cachedInputs
        val now = System.currentTimeMillis()
        if (cached != null && policyVersion != null && cached.policyVersion == policyVersion &&
            now - cached.fetchedAt < INPUT_CACHE_MAX_AGE_MS) {
            return cached
        }

        val schedules = fetchRows(context, "pc_schedules", "child_id=eq.$childId&select=*")
        val rules = fetchRows(context, "pc_app_rules", "child_id=eq.$childId&select=*")
        if (schedules == null || rules == null) return null
        val inputs = PolicyInputs(
            policyVersion = policyVersion,
            schedules = schedules,
            rules = rules,
            screenTimeRule = fetchRows(context, "pc_screen_time_rules", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            restricted = fetchRows(context, "pc_restricted_times", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            websiteRules = fetchRows(context, "pc_website_rules", "child_id=eq.$childId&is_enabled=eq.true&select=domain,action"),
            categoryRules = fetchRows(context, "pc_website_category_rules", "child_id=eq.$childId&select=category_key,action"),
            filterSettings = fetchRows(context, "pc_website_filter_settings", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            fetchedAt = now,
        )
        cachedInputs = inputs
        return inputs
    }

    /** Drops the input cache so the next pass re-reads everything (sync_rules command, reassignment). */
    fun invalidateCache() {
        cachedInputs = null
    }

    /** One enforcement pass at a time — called from VoiceKidsMonitorService's single executor thread already. */
    @Synchronized
    fun enforce(context: Context) {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return

        val inputs = loadInputs(context, childId)
        if (inputs == null) {
            // A failed fetch must never be treated as "no rules" — that would
            // unsuspend every blocked app the moment the network hiccups.
            Log.w(TAG, "enforce: fetch failed, skipping pass")
            return
        }
        val schedules = inputs.schedules
        val rules = inputs.rules
        val screenTimeRule = inputs.screenTimeRule
        val restricted = inputs.restricted
        val policyVersion = inputs.policyVersion
        val websiteRules = inputs.websiteRules
        val categoryRules = inputs.categoryRules
        val filterSettings = inputs.filterSettings

        val bonusActive = VoiceKidsPrefs.isBonusActive(context)
        val now = Calendar.getInstance()
        val dow = now.get(Calendar.DAY_OF_WEEK) - 1 // Calendar.SUNDAY=1 -> JS getDay()=0

        val activeSchedule = findActiveSchedule(schedules, now, bonusActive)
        val usageAvailable = UsageStatsHelper.hasUsageAccess(context)
        val usageByPackage: Map<String, Long> = if (usageAvailable) {
            UsageStatsHelper.queryTodayUsage(context).associate { it.packageName to it.totalForegroundMs }
        } else emptyMap()

        // ── Daily screen time (mirrors screenTimePolicy.js) ─────────────
        val usedMin = (totalScreenTimeMs(usageByPackage) / 60_000L).toInt()
        val limitMin = limitForDay(screenTimeRule, dow)
        VoiceKidsPrefs.setScreenTimeSnapshot(context, if (usageAvailable) usedMin else -1, limitMin)
        val limitReached = limitMin != null && usageAvailable && !bonusActive && usedMin >= limitMin

        // ── App rules ───────────────────────────────────────────────────
        val (blockListBase, allowList, alertOnUse) = resolveAppRules(rules, usageByPackage, usageAvailable, bonusActive, dow)
        VoiceKidsPrefs.setAlertOnUsePackages(context, alertOnUse)

        // ── Web filtering settings ──────────────────────────────────────
        val applyFilters = filterSettings?.optBoolean("apply_filters", true) ?: true
        val blockUnsupportedBrowsers = applyFilters && (filterSettings?.optBoolean("block_unsupported_browsers", false) ?: false)
        val blockUnknownWebsites = applyFilters && (filterSettings?.optBoolean("block_unknown_websites", false) ?: false)
        val enforceSafeSearch = applyFilters && (filterSettings?.optBoolean("enforce_safe_search", false) ?: false)
        val alertOnBlock = filterSettings?.optBoolean("alert_on_block", true) ?: true
        // Opt-in, default off — website blocking works through the
        // accessibility URL read (WebPolicy) without any tunnel.
        val useVpn = applyFilters && (filterSettings?.optBoolean("use_vpn", false) ?: false)
        VoiceKidsPrefs.setUseVpnFiltering(context, useVpn)

        // "Block unsupported browsers": kick to home any known browser app
        // that isn't one VoiceKidsAccessibilityService can actually read
        // the address bar of / DNS filtering can't be bypassed via — see
        // WebCategories.kt's doc comment.
        val blockList = if (blockUnsupportedBrowsers) blockListBase + WebCategories.OTHER_KNOWN_BROWSER_PACKAGES else blockListBase

        val categories = resolveCategoryDomains(categoryRules)
        val ruleDomains = resolveWebsiteRuleDomains(websiteRules)
        val blockedDomains = ruleDomains?.let { it.blocked + (if (applyFilters) categories.blocked else emptySet()) }
        val allowedDomains = (ruleDomains?.allowed ?: emptySet()) + (if (applyFilters) categories.allowed else emptySet())
        val alertDomains = (ruleDomains?.alerted ?: emptySet()) + (if (applyFilters) categories.alerted else emptySet())
        VoiceKidsPrefs.setAllowedDomains(context, allowedDomains)
        VoiceKidsPrefs.setAlertDomains(context, alertDomains)
        VoiceKidsPrefs.setBlockUnknownWebsites(context, blockUnknownWebsites)
        VoiceKidsPrefs.setEnforceSafeSearch(context, enforceSafeSearch)
        VoiceKidsPrefs.setAlertOnWebsiteBlock(context, alertOnBlock)

        // ── Whole-device lock resolution (mirrors resolveLockState) ─────
        // Priority: bonus time > parent's explicit "Lock now" > active
        // schedule > restricted-time cell > daily limit. Bonus already
        // zeroed activeSchedule/limitReached.
        val restrictedActive = !bonusActive && isRestrictedNow(restricted, now)
        val parentLock = !bonusActive && VoiceKidsPrefs.parentLockActive(context)
        val lock: LockDecision? = when {
            parentLock -> LockDecision("parent_lock", "parent_lock", "lock_device", "Locked by parent")
            activeSchedule != null -> {
                val action = activeSchedule.optString("action")
                LockDecision(
                    key = "schedule:${activeSchedule.optString("id")}",
                    reason = if (action == "block_internet") "" else "schedule",
                    action = action,
                    label = activeSchedule.optString("name"),
                    schedule = activeSchedule,
                )
            }
            restrictedActive -> {
                val action = restricted!!.optString("action").takeIf { it in setOf("lock_navigation", "lock_device", "block_internet") } ?: "lock_navigation"
                LockDecision("restricted_time", if (action == "block_internet") "" else "restricted_time", action, "Restricted time")
            }
            limitReached -> {
                val action = screenTimeRule!!.optString("limit_action").takeIf { it in setOf("lock_navigation", "lock_device", "alert_only") } ?: "lock_navigation"
                LockDecision("daily_limit", if (action == "alert_only") "" else "daily_limit", action, "Daily limit")
            }
            else -> null
        }

        // Parent-facing alerts for the two limit events (once per day / per
        // window), independent of whether the lock action is alert_only.
        if (limitReached && (screenTimeRule?.optBoolean("alert_on_limit", true) ?: true)) {
            val today = isoDate(System.currentTimeMillis())
            if (VoiceKidsPrefs.lastLimitAlertDate(context) != today) {
                VoiceKidsPrefs.setLastLimitAlertDate(context, today)
                insertAlert(context, deviceId, childId, "screen_time_exceeded", "warning",
                    "Daily screen-time limit reached",
                    "$usedMin minutes used of today's $limitMin minute limit.",
                    JSONObject().put("total_minutes", usedMin).put("limit_minutes", limitMin))
            }
        }

        val manualPause = VoiceKidsPrefs.manualInternetPause(context)
        val signature = "v=$policyVersion|lock=${lock?.key}:${lock?.action}|pause=$manualPause|" +
            "${blockList.sorted()}|${allowList.sorted()}|${alertOnUse.sorted()}|${blockedDomains?.sorted()}|" +
            "$blockUnknownWebsites|$enforceSafeSearch|${allowedDomains.sorted()}|${alertDomains.sorted()}"
        val appliedSignature = VoiceKidsPrefs.appliedSignature(context)
        val appliedLockKey = VoiceKidsPrefs.appliedLockKey(context)

        if (signature == appliedSignature && lock == null && appliedLockKey.isEmpty()) {
            return // nothing changed since the last successful pass
        }

        val deviceAdmin = DpcActions.isDeviceAdmin(context)
        val deviceOwner = DpcActions.isDeviceOwner(context)
        val vpnConsent = DpcActions.hasVpnConsent(context)
        // The pause itself no longer depends on VPN consent: the
        // accessibility service keeps every internet-using app off screen
        // (VoiceKidsPrefs.internetPauseActive). The tunnel, when consented,
        // is an extra layer that also stops background traffic.
        val internetPauseWanted = lock?.pausesInternet == true || manualPause
        VoiceKidsPrefs.setInternetPauseActive(context, internetPauseWanted)
        val internetPausedByLock = internetPauseWanted && vpnConsent
        // Accessibility-based soft blocking (VoiceKidsAccessibilityService)
        // needs no Device Admin/Owner at all — it's a separate OS permission.
        // Device Admin is only needed here for lockDevice()/pauseInternet().
        // We always write the desired block/allow state below regardless of
        // deviceAdmin, so a device with only Accessibility enabled (no admin
        // yet) still gets real app-blocking — just not lockNow()/VPN pause.

        var ok = true
        val lockTransition = (lock?.key ?: "") != appliedLockKey

        // ── Whole-device lock enforcement ───────────────────────────────
        // Soft-lock state (desired*) is always written for
        // VoiceKidsAccessibilityService to enforce, regardless of Device
        // Admin/Owner status. Device Owner additionally gets the harder
        // OS-level lock-task calls as a bonus (see DpcActions.kt).
        if (lock != null) {
            val allowed = jsonStringArray(lock.schedule?.optJSONArray("always_allowed_packages"))
            when {
                lock.action == "allow_list_only" || (lock.action == "block_all" && allowed.isNotEmpty()) -> {
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, allowed.toSet())
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                    if (deviceOwner) ok = DpcActions.setAllowedPackages(context, allowed)
                }
                lock.blocksApps -> {
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, true)
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                }
                else -> {
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                }
            }
            if (lock.pausesInternet) {
                // Internet pause is best-effort: without the one-time VPN
                // consent the app-level lock still stands, so a missing
                // consent is reported (vpn_consent=false) rather than
                // treated as an enforcement failure.
                if (vpnConsent) ok = DpcActions.pauseInternet(context) && ok
            }
            // Hard screen lock ONLY on the transition into this lock — not on
            // every 4-second pass, which would keep switching the screen off
            // for the whole window and hide the "ask for more time" screen.
            if (lockTransition && lock.wantsHardLock && deviceAdmin) DpcActions.lockDevice(context)
            VoiceKidsPrefs.setLockReason(context, lock.reason)
            VoiceKidsPrefs.setLockLabel(context, lock.label)
            VoiceKidsPrefs.setAppliedLockKey(context, lock.key)
            VoiceKidsPrefs.setAppliedScheduleLock(context, true)
        } else if (appliedLockKey.isNotEmpty() || VoiceKidsPrefs.appliedScheduleLock(context)) {
            VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
            VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
            VoiceKidsPrefs.setLockReason(context, "")
            VoiceKidsPrefs.setLockLabel(context, "")
            if (deviceAdmin) DpcActions.unlockDevice(context)
            // A parent's explicit "Pause internet" outlives any schedule/limit
            // window — only tear the tunnel down when nothing else wants it.
            if (!manualPause) DpcActions.resumeInternet(context)
            VoiceKidsPrefs.setAppliedLockKey(context, "")
            VoiceKidsPrefs.setAppliedScheduleLock(context, false)
        }

        // Manual "Pause internet" is kept in force across passes (cheap no-op
        // when the tunnel is already up in block-all mode) so nothing below
        // can accidentally swap the tunnel back to DNS-filter mode.
        if (manualPause && vpnConsent && lock?.pausesInternet != true) ok = DpcActions.pauseInternet(context) && ok

        // ── Per-app reconciliation ──────────────────────────────────────
        // Primary mechanism: write the desired set for
        // VoiceKidsAccessibilityService to enforce (works under Device
        // Admin only, no reset needed). Device Owner additionally gets a
        // real setPackagesSuspended() call as a stronger bonus layer.
        val desiredSet = blockList.filterNot { isProtectedPackage(it) }.toSet()
        VoiceKidsPrefs.setDesiredBlockedPackages(context, desiredSet)

        var suspendOk = true
        if (deviceOwner) {
            val appliedSuspended = VoiceKidsPrefs.appliedSuspended(context)
            val toSuspend = (desiredSet - appliedSuspended).toList()
            val toUnsuspend = (appliedSuspended - desiredSet).filterNot { isProtectedPackage(it) }
            if (toSuspend.isNotEmpty()) suspendOk = DpcActions.setPackagesSuspended(context, toSuspend, true) != null
            if (toUnsuspend.isNotEmpty()) suspendOk = suspendOk && DpcActions.setPackagesSuspended(context, toUnsuspend, false) != null
            if (suspendOk) VoiceKidsPrefs.setAppliedSuspended(context, desiredSet)
        }

        val settled = suspendOk && ok
        if (settled) {
            VoiceKidsPrefs.setAppliedSignature(context, signature)
        } else {
            VoiceKidsPrefs.setAppliedSignature(context, null) // force retry next tick
        }

        // ── Website filtering (pc_website_rules enforcement) ────────────
        // See DpcActions.startWebsiteFilter/InternetBlockVpnService's
        // MODE_DNS_FILTER for the actual mechanism. Skipped entirely when
        // the websiteRules fetch itself failed (null) — same
        // fail-safe-by-not-changing-anything rule as schedules/app rules.
        var websiteFilterActive = VoiceKidsPrefs.websiteFilterActive(context)
        if (blockedDomains != null) {
            VoiceKidsPrefs.setBlockedDomains(context, blockedDomains)
            // A lock (or the parent's manual pause) that pauses internet
            // already owns the VPN tunnel via pauseInternet() above
            // (MODE_BLOCK_ALL) — domain filtering would be moot underneath a
            // full internet pause, and only one VPN mode can hold the tunnel
            // at a time anyway.
            val lockOwnsVpn = internetPausedByLock
            val desiredWebsiteFilter = useVpn &&
                (blockedDomains.isNotEmpty() || blockUnknownWebsites || enforceSafeSearch || alertDomains.isNotEmpty()) &&
                !lockOwnsVpn && vpnConsent
            if (desiredWebsiteFilter != websiteFilterActive) {
                if (desiredWebsiteFilter) {
                    if (DpcActions.startWebsiteFilter(context)) {
                        websiteFilterActive = true
                        VoiceKidsPrefs.setWebsiteFilterActive(context, true)
                    }
                } else if (lockOwnsVpn) {
                    // pauseInternet() (MODE_BLOCK_ALL) took the tunnel THIS
                    // pass — never call stopWebsiteFilter() here, it would
                    // tear that back down. Just record we no longer drive it.
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                } else if (DpcActions.stopWebsiteFilter(context)) {
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                }
            }
        }

        reportEnforcementState(context, deviceId, policyVersion, mapOf(
            "device_admin" to deviceAdmin,
            "device_owner" to deviceOwner,
            "accessibility_enabled" to AccessibilityStatus.isEnabled(context),
            "overlay_granted" to DpcActions.canDrawOverlays(context),
            "vpn_consent" to vpnConsent,
            "usage_access" to usageAvailable,
            "active_schedule" to (activeSchedule?.optString("name")),
            "lock_reason" to (lock?.reason?.takeIf { it.isNotEmpty() }),
            "lock_action" to lock?.action,
            "internet_paused" to internetPausedByLock,
            "manual_internet_pause" to manualPause,
            "screen_time_today_min" to (if (usageAvailable) usedMin else null),
            "screen_time_limit_min" to limitMin,
            "desired_blocked_count" to desiredSet.size,
            "website_filter_active" to websiteFilterActive,
            "last_error" to if (settled) null else "partial_apply_failure",
        ))
    }

    // ── Schedule resolution (mirrors isScheduleActive/findActiveSchedule) ──

    private fun parseHm(value: String?): Int? {
        if (value == null) return null
        val m = Regex("^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$").find(value.trim()) ?: return null
        val h = m.groupValues[1].toIntOrNull() ?: return null
        val min = m.groupValues[2].toIntOrNull() ?: return null
        if (h > 23 || min > 59) return null
        return h * 60 + min
    }

    private fun isTimeInRange(start: String?, end: String?, nowMin: Int): Boolean {
        val s = parseHm(start) ?: return false
        val e = parseHm(end) ?: return false
        if (s == e) return false
        return if (e < s) nowMin >= s || nowMin < e else nowMin >= s && nowMin < e
    }

    private fun isScheduleActive(schedule: JSONObject, now: Calendar): Boolean {
        if (!schedule.optBoolean("is_enabled", true)) return false
        val days = schedule.optJSONArray("days_of_week") ?: return false
        val today = now.get(Calendar.DAY_OF_WEEK) - 1 // Calendar.SUNDAY=1 -> JS getDay()=0
        var matchesDay = false
        for (i in 0 until days.length()) if (days.optInt(i, -1) == today) matchesDay = true
        if (!matchesDay) return false
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        // optString() with no fallback defaults to "" (never null) for a missing/non-string
        // key — parseHm() already treats anything that doesn't match HH:MM as invalid.
        return isTimeInRange(schedule.optString("start_time"), schedule.optString("end_time"), nowMin)
    }

    private fun findActiveSchedule(schedules: JSONArray, now: Calendar, bonusActive: Boolean): JSONObject? {
        if (bonusActive) return null
        var best: JSONObject? = null
        var bestSeverity = -1
        for (i in 0 until schedules.length()) {
            val s = schedules.getJSONObject(i)
            if (!isScheduleActive(s, now)) continue
            val severity = SCHEDULE_SEVERITY[s.optString("action")] ?: 0
            if (severity > bestSeverity || (severity == bestSeverity && best != null &&
                    s.optString("id") < best.optString("id"))) {
                best = s
                bestSeverity = severity
            }
        }
        return best
    }

    // ── Daily limit / restricted time (mirrors screenTimePolicy.js) ─────

    /** Foreground ms across all apps except launcher/system UI/VOICE itself. */
    fun totalScreenTimeMs(usageByPackage: Map<String, Long>): Long =
        usageByPackage.entries.filter { it.key !in SCREEN_TIME_EXCLUDED && it.value > 0 }.sumOf { it.value }

    /** Today's limit in minutes honouring daily_limits_by_dow; null = no limit (rule missing/disabled). 0 is a real limit. */
    fun limitForDay(rule: JSONObject?, dow: Int): Int? {
        if (rule == null || !rule.optBoolean("is_enabled", true)) return null
        val byDow = rule.optJSONObject("daily_limits_by_dow")
        if (byDow != null && byDow.has(dow.toString()) && !byDow.isNull(dow.toString())) {
            val v = byDow.optDouble(dow.toString(), -1.0)
            if (v >= 0) return v.toInt()
        }
        val base = rule.optDouble("daily_limit_min", -1.0)
        return if (base >= 0) base.toInt() else null
    }

    /** Per-app variant for time_limit rules: null = no limit (matches policy.js invalid_limit for <= 0 base). */
    private fun appLimitForDay(rule: JSONObject, dow: Int): Int? {
        val byDow = rule.optJSONObject("daily_limits_by_dow")
        if (byDow != null && byDow.has(dow.toString()) && !byDow.isNull(dow.toString())) {
            val v = byDow.optDouble(dow.toString(), -1.0)
            if (v >= 0) return v.toInt()
        }
        val base = rule.optDouble("daily_limit_min", -1.0)
        return if (base > 0) base.toInt() else null
    }

    /** True when `now` falls in a pc_restricted_times.cells {"<dow>": [hours...]} cell. */
    fun isRestrictedNow(restricted: JSONObject?, now: Calendar): Boolean {
        if (restricted == null || !restricted.optBoolean("is_enabled", true)) return false
        val cells = restricted.optJSONObject("cells") ?: return false
        val dow = now.get(Calendar.DAY_OF_WEEK) - 1
        val hours = cells.optJSONArray(dow.toString()) ?: return false
        val hour = now.get(Calendar.HOUR_OF_DAY)
        for (i in 0 until hours.length()) if (hours.optInt(i, -1) == hour) return true
        return false
    }

    // ── App-rule resolution (mirrors resolvePolicy) ─────────────────────

    private data class AppRuleResolution(val blockList: List<String>, val allowList: List<String>, val alertOnUse: Set<String>)

    private fun resolveAppRules(
        rules: JSONArray,
        usageByPackage: Map<String, Long>,
        usageAvailable: Boolean,
        bonusActive: Boolean,
        dow: Int,
    ): AppRuleResolution {
        val blockSet = mutableSetOf<String>()
        val allowSet = mutableSetOf<String>()
        val alertSet = mutableSetOf<String>()

        for (i in 0 until rules.length()) {
            val rule = rules.getJSONObject(i)
            if (!rule.optBoolean("is_enabled", true)) continue
            val pkg = rule.optString("package_name").takeIf { it.isNotEmpty() } ?: continue
            if (rule.optBoolean("alert_on_use", false) && !isProtectedPackage(pkg)) alertSet.add(pkg)
            when (rule.optString("action")) {
                "allow" -> allowSet.add(pkg)
                else -> if (!isProtectedPackage(pkg)) {
                    when (rule.optString("action")) {
                        "block" -> blockSet.add(pkg)
                        "time_limit" -> {
                            val limitMin = appLimitForDay(rule, dow)
                            if (limitMin != null && usageAvailable && !bonusActive) {
                                val usedMin = (usageByPackage[pkg] ?: 0L) / 60_000
                                if (usedMin >= limitMin) blockSet.add(pkg)
                            }
                        }
                    }
                }
            }
        }
        for (pkg in allowSet) blockSet.remove(pkg)
        return AppRuleResolution(blockSet.toList(), allowSet.toList(), alertSet)
    }

    private fun isProtectedPackage(pkg: String): Boolean = PROTECTED_PACKAGES.contains(pkg)

    // ── Website-rule resolution ──────────────────────────────────────────

    private data class DomainSets(val blocked: Set<String>, val allowed: Set<String>, val alerted: Set<String>)

    /**
     * Splits enabled pc_website_rules rows into blocked / allowed / alert
     * domain sets. Returns null (not empty) when the fetch itself failed, so
     * the caller can distinguish "no rules" from "couldn't check" and avoid
     * flipping filtering off on a network blip.
     */
    private fun resolveWebsiteRuleDomains(websiteRules: JSONArray?): DomainSets? {
        if (websiteRules == null) return null
        val blocked = mutableSetOf<String>()
        val allowed = mutableSetOf<String>()
        val alerted = mutableSetOf<String>()
        for (i in 0 until websiteRules.length()) {
            val rule = websiteRules.getJSONObject(i)
            val domain = rule.optString("domain").trim().lowercase().takeIf { it.isNotEmpty() } ?: continue
            when (rule.optString("action")) {
                "block" -> blocked.add(domain)
                "allow" -> allowed.add(domain)
                "alert" -> alerted.add(domain)
            }
        }
        return DomainSets(blocked, allowed, alerted)
    }

    /**
     * Resolves per-category allow/block/alert into concrete domain sets via
     * WebCategories.CATEGORY_DOMAINS. A category with no explicit row
     * uses its own default (see src/lib/webCategories.js defaultAction) —
     * matters because most categories default to 'allow' and only a
     * handful (gambling, violence, pornography, ...) default to 'block'.
     */
    private fun resolveCategoryDomains(categoryRules: JSONArray?): DomainSets {
        val explicit = mutableMapOf<String, String>() // category_key -> action
        if (categoryRules != null) {
            for (i in 0 until categoryRules.length()) {
                val row = categoryRules.getJSONObject(i)
                val key = row.optString("category_key").takeIf { it.isNotEmpty() } ?: continue
                explicit[key] = row.optString("action")
            }
        }
        val blocked = mutableSetOf<String>()
        val allowed = mutableSetOf<String>()
        val alerted = mutableSetOf<String>()
        for ((key, domains) in WebCategories.CATEGORY_DOMAINS) {
            when (explicit[key] ?: DEFAULT_CATEGORY_ACTION[key] ?: "allow") {
                "block" -> blocked.addAll(domains)
                "alert" -> alerted.addAll(domains)
                else -> allowed.addAll(domains)
            }
        }
        return DomainSets(blocked, allowed, alerted)
    }

    // Mirrors src/lib/webCategories.js's per-category defaultAction — kept
    // in sync manually (only the categories that default to 'block' need
    // listing; everything else defaults to 'allow').
    private val DEFAULT_CATEGORY_ACTION = mapOf(
        "gambling" to "block",
        "proxies_loopholes" to "block",
        "violence" to "block",
        "weapons" to "block",
        "profanity" to "block",
        "mature_content" to "block",
        "pornography" to "block",
        "alcohol" to "block",
        "drugs" to "block",
        "tobacco" to "block",
    )

    // ── I/O helpers ──────────────────────────────────────────────────────

    private fun fetchRows(context: Context, table: String, query: String): JSONArray? =
        SupabaseRest.get(context, table, query)

    private fun jsonStringArray(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it, null) }
    }

    private fun insertAlert(
        context: Context, deviceId: String, childId: String,
        type: String, severity: String, title: String, body: String, metadata: JSONObject?,
    ) {
        val row = JSONObject().apply {
            put("child_id", childId)
            put("device_id", deviceId)
            put("alert_type", type)
            put("severity", severity)
            put("title", title)
            put("body", body)
            if (metadata != null) put("metadata", metadata)
        }
        SupabaseRest.insert(context, "pc_alerts", row)
    }

    private fun reportEnforcementState(context: Context, deviceId: String, policyVersion: Long?, state: Map<String, Any?>) {
        val json = JSONObject()
        for ((k, v) in state) {
            when (v) {
                null -> json.put(k, JSONObject.NULL)
                else -> json.put(k, v)
            }
        }
        val body = JSONObject()
            .put("enforcement_state", json)
            .put("last_enforcement_at", isoTimestamp(System.currentTimeMillis()))
            .put("platform", "android")
        // Confirms to the parent which pc_children.policy_version this device
        // has actually applied — drives the "Policy version X of Y applied" /
        // syncing indicator (src/lib/policySync.js). Only written when we
        // could read the version; a failed read leaves the last value alone.
        if (policyVersion != null) body.put("applied_policy_version", policyVersion)
        SupabaseRest.patch(context, "pc_devices", "id=eq.$deviceId", body)
    }

    private fun isoTimestamp(epochMillis: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(epochMillis))
    }

    /** Device-local calendar date — the child's "today" for once-a-day alerts. */
    private fun isoDate(epochMillis: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(epochMillis))
}
