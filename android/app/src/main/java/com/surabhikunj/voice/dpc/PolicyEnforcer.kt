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
 * PolicyEnforcer — native port of src/lib/policy.js + src/lib/ruleEngine.js.
 *
 * WHY THIS EXISTS: schedules (block_all / block_internet / allow_list_only)
 * and per-app rules (allow / block / time_limit) were previously enforced
 * ONLY by ruleEngine.js running inside commandPoller.js's setInterval in the
 * WebView. Android suspends a backgrounded WebView's JS timers, so the
 * moment the child closes the app (or the screen locks), schedule
 * transitions and time-limit checks stopped updating in real time — a
 * schedule that should start blocking at 8pm, or a time-limit that should
 * kick in once a daily cap is reached, would silently not take effect until
 * the child happened to reopen the app. This mirrors that same decision
 * logic natively so VoiceKidsMonitorService can enforce it on its own
 * cadence (see COMMAND_POLL_INTERVAL_MS in that file), exactly like
 * lock/unlock/pause/resume already do.
 *
 * Keep this in sync with policy.js — same protected-package list, same
 * schedule-severity order, same allow-overrides-block rule. Any drift
 * between the two would mean the child sees different enforcement
 * depending on whether the WebView or this native pass last acted.
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

    private val SCHEDULE_SEVERITY = mapOf(
        "block_all" to 3,
        "allow_list_only" to 2,
        "block_internet" to 1,
    )

    /** One enforcement pass at a time — called from VoiceKidsMonitorService's single executor thread already. */
    fun enforce(context: Context) {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return

        val schedules = fetchRows(context, "pc_schedules", "child_id=eq.$childId&select=*")
        val rules = fetchRows(context, "pc_app_rules", "child_id=eq.$childId&select=*")
        if (schedules == null || rules == null) {
            // A failed fetch must never be treated as "no rules" — that would
            // unsuspend every blocked app the moment the network hiccups.
            Log.w(TAG, "enforce: fetch failed, skipping pass")
            return
        }
        // Website rules are fetched separately and tolerate failure without
        // aborting the whole pass — a transient failure here shouldn't also
        // block app-rule/schedule enforcement (see the website-filtering
        // block near the end of this function, which simply skips updating
        // when this is null rather than treating it as "no blocked domains").
        val websiteRules = fetchRows(context, "pc_website_rules", "child_id=eq.$childId&is_enabled=eq.true&select=domain,action")
        val categoryRules = fetchRows(context, "pc_website_category_rules", "child_id=eq.$childId&select=category_key,action")
        val filterSettingsRows = fetchRows(context, "pc_website_filter_settings", "child_id=eq.$childId&select=*")
        val filterSettings = filterSettingsRows?.optJSONObject(0)

        val bonusActive = VoiceKidsPrefs.isBonusActive(context)
        val now = Calendar.getInstance()

        val activeSchedule = findActiveSchedule(schedules, now, bonusActive)
        val usageAvailable = UsageStatsHelper.hasUsageAccess(context)
        val usageByPackage: Map<String, Long> = if (usageAvailable) {
            UsageStatsHelper.queryTodayUsage(context).associate { it.packageName to it.totalForegroundMs }
        } else emptyMap()

        val (blockListBase, allowList) = resolveAppRules(rules, usageByPackage, usageAvailable, bonusActive)
        val applyFilters = filterSettings?.optBoolean("apply_filters", true) ?: true
        val blockUnsupportedBrowsers = applyFilters && (filterSettings?.optBoolean("block_unsupported_browsers", false) ?: false)
        val blockUnknownWebsites = applyFilters && (filterSettings?.optBoolean("block_unknown_websites", false) ?: false)
        val enforceSafeSearch = applyFilters && (filterSettings?.optBoolean("enforce_safe_search", false) ?: false)
        val alertOnBlock = filterSettings?.optBoolean("alert_on_block", true) ?: true

        // "Block unsupported browsers": kick to home any known browser app
        // that isn't one VoiceKidsAccessibilityService can actually read
        // the address bar of / DNS filtering can't be bypassed via — see
        // WebCategories.kt's doc comment.
        val blockList = if (blockUnsupportedBrowsers) {
            blockListBase + WebCategories.OTHER_KNOWN_BROWSER_PACKAGES
        } else blockListBase

        val (categoryBlockedDomains, categoryAllowedDomains) = resolveCategoryDomains(categoryRules)
        val blockedDomains = resolveBlockedDomains(websiteRules)?.let { it + (if (applyFilters) categoryBlockedDomains else emptySet()) }
        val allowedDomains = (resolveAllowedDomains(websiteRules) ?: emptySet()) + (if (applyFilters) categoryAllowedDomains else emptySet())
        VoiceKidsPrefs.setAllowedDomains(context, allowedDomains)
        VoiceKidsPrefs.setBlockUnknownWebsites(context, blockUnknownWebsites)
        VoiceKidsPrefs.setEnforceSafeSearch(context, enforceSafeSearch)
        VoiceKidsPrefs.setAlertOnWebsiteBlock(context, alertOnBlock)

        val signature = "${activeSchedule?.optString("id")}|${activeSchedule?.optString("action")}|" +
            "${blockList.sorted()}|${allowList.sorted()}|${blockedDomains?.sorted()}|" +
            "$blockUnknownWebsites|$enforceSafeSearch|${allowedDomains.sorted()}"
        val appliedSignature = VoiceKidsPrefs.appliedSignature(context)
        val appliedScheduleLock = VoiceKidsPrefs.appliedScheduleLock(context)

        if (signature == appliedSignature && activeSchedule == null && !appliedScheduleLock) {
            return // nothing changed since the last successful pass
        }

        val deviceAdmin = DpcActions.isDeviceAdmin(context)
        val deviceOwner = DpcActions.isDeviceOwner(context)
        // Accessibility-based soft blocking (VoiceKidsAccessibilityService)
        // needs no Device Admin/Owner at all — it's a separate OS permission.
        // Device Admin is only needed here for lockDevice()/pauseInternet().
        // We always write the desired block/allow state below regardless of
        // deviceAdmin, so a device with only Accessibility enabled (no admin
        // yet) still gets real app-blocking — just not lockNow()/VPN pause.

        var ok = true

        // ── Schedule-level enforcement ──────────────────────────────────
        // Soft-lock state (desired*) is always written for
        // VoiceKidsAccessibilityService to enforce, regardless of Device
        // Admin/Owner status. Device Owner additionally gets the harder
        // OS-level lock-task/suspend calls as a bonus (see DpcActions.kt).
        if (activeSchedule != null) {
            val action = activeSchedule.optString("action")
            when (action) {
                "block_all" -> {
                    val allowed = jsonStringArray(activeSchedule.optJSONArray("always_allowed_packages"))
                    if (allowed.isNotEmpty()) {
                        VoiceKidsPrefs.setDesiredAllowListPackages(context, allowed.toSet())
                        VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                        if (deviceOwner) ok = DpcActions.setAllowedPackages(context, allowed)
                    } else {
                        VoiceKidsPrefs.setDesiredBlockAllActive(context, true)
                        VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                        // Best-effort hard lock too (works if no PIN is set, or under
                        // Device Owner); the Accessibility soft-lock above is the
                        // real guarantee when this doesn't fully hold.
                        if (deviceAdmin) DpcActions.lockDevice(context)
                    }
                }
                "block_internet" -> {
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                    ok = DpcActions.pauseInternet(context)
                }
                "allow_list_only" -> {
                    val allowed = jsonStringArray(activeSchedule.optJSONArray("always_allowed_packages"))
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, allowed.toSet())
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                    if (deviceOwner) ok = DpcActions.setAllowedPackages(context, allowed)
                }
            }
            VoiceKidsPrefs.setAppliedScheduleLock(context, true)
        } else if (appliedScheduleLock) {
            VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
            VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
            if (deviceAdmin) DpcActions.unlockDevice(context)
            DpcActions.resumeInternet(context)
            VoiceKidsPrefs.setAppliedScheduleLock(context, false)
        }

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
            // A block_internet schedule already owns the VPN tunnel via
            // pauseInternet() above (MODE_BLOCK_ALL) — domain filtering
            // would be moot underneath a full internet pause, and only one
            // VPN mode can hold the tunnel at a time anyway.
            val scheduleOwnsVpn = activeSchedule?.optString("action") == "block_internet"
            val desiredWebsiteFilter = (blockedDomains.isNotEmpty() || blockUnknownWebsites || enforceSafeSearch) &&
                !scheduleOwnsVpn && DpcActions.hasVpnConsent(context)
            if (desiredWebsiteFilter != websiteFilterActive) {
                if (desiredWebsiteFilter) {
                    if (DpcActions.startWebsiteFilter(context)) {
                        websiteFilterActive = true
                        VoiceKidsPrefs.setWebsiteFilterActive(context, true)
                    }
                } else if (scheduleOwnsVpn) {
                    // The schedule block above just called pauseInternet()
                    // (MODE_BLOCK_ALL) THIS SAME pass — never call
                    // stopWebsiteFilter() here, it would tear that back
                    // down. Just record that we're no longer the one
                    // driving the tunnel.
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                } else if (DpcActions.stopWebsiteFilter(context)) {
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                }
            }
        }

        reportEnforcementState(context, deviceId, mapOf(
            "device_admin" to deviceAdmin,
            "device_owner" to deviceOwner,
            "accessibility_enabled" to AccessibilityStatus.isEnabled(context),
            "overlay_granted" to DpcActions.canDrawOverlays(context),
            "vpn_consent" to DpcActions.hasVpnConsent(context),
            "usage_access" to usageAvailable,
            "active_schedule" to (activeSchedule?.optString("name")),
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

    // ── App-rule resolution (mirrors resolvePolicy) ─────────────────────

    private fun resolveAppRules(
        rules: JSONArray,
        usageByPackage: Map<String, Long>,
        usageAvailable: Boolean,
        bonusActive: Boolean,
    ): Pair<List<String>, List<String>> {
        val blockSet = mutableSetOf<String>()
        val allowSet = mutableSetOf<String>()

        for (i in 0 until rules.length()) {
            val rule = rules.getJSONObject(i)
            if (!rule.optBoolean("is_enabled", true)) continue
            val pkg = rule.optString("package_name").takeIf { it.isNotEmpty() } ?: continue
            when (rule.optString("action")) {
                "allow" -> allowSet.add(pkg)
                else -> if (!isProtectedPackage(pkg)) {
                    when (rule.optString("action")) {
                        "block" -> blockSet.add(pkg)
                        "time_limit" -> {
                            val limitMin = rule.optDouble("daily_limit_min", -1.0)
                            if (limitMin > 0 && usageAvailable && !bonusActive) {
                                val usedMin = (usageByPackage[pkg] ?: 0L) / 60_000
                                if (usedMin >= limitMin) blockSet.add(pkg)
                            }
                        }
                    }
                }
            }
        }
        for (pkg in allowSet) blockSet.remove(pkg)
        return blockSet.toList() to allowSet.toList()
    }

    private fun isProtectedPackage(pkg: String): Boolean = PROTECTED_PACKAGES.contains(pkg)

    // ── Website-rule resolution ──────────────────────────────────────────
    // Only 'block' rules matter for enforcement — 'allow' rules exist in
    // the schema for a future default-deny allow-list mode, but with no
    // such mode implemented yet an 'allow' row has no enforcement effect
    // (mirrors pc_website_rules' current schema-only history — see
    // PLATFORM_LIMITATIONS.md). Returns null (not empty) when the fetch
    // itself failed, so the caller can distinguish "no rules" from
    // "couldn't check" and avoid flipping filtering off on a network blip.
    private fun resolveBlockedDomains(websiteRules: JSONArray?): Set<String>? {
        if (websiteRules == null) return null
        val blocked = mutableSetOf<String>()
        for (i in 0 until websiteRules.length()) {
            val rule = websiteRules.getJSONObject(i)
            if (rule.optString("action") == "block") {
                rule.optString("domain").trim().lowercase().takeIf { it.isNotEmpty() }?.let { blocked.add(it) }
            }
        }
        return blocked
    }

    /** Individually allow-listed domains (rule.action == 'allow') — overrides a category block on conflict. Null on fetch failure, mirrors resolveBlockedDomains. */
    private fun resolveAllowedDomains(websiteRules: JSONArray?): Set<String>? {
        if (websiteRules == null) return null
        val allowed = mutableSetOf<String>()
        for (i in 0 until websiteRules.length()) {
            val rule = websiteRules.getJSONObject(i)
            if (rule.optString("action") == "allow") {
                rule.optString("domain").trim().lowercase().takeIf { it.isNotEmpty() }?.let { allowed.add(it) }
            }
        }
        return allowed
    }

    /**
     * Resolves per-category allow/block into concrete domain sets via
     * WebCategories.CATEGORY_DOMAINS. A category with no explicit row
     * uses its own default (see src/lib/webCategories.js defaultAction) —
     * matters because most categories default to 'allow' and only a
     * handful (gambling, violence, pornography, ...) default to 'block'.
     */
    private fun resolveCategoryDomains(categoryRules: JSONArray?): Pair<Set<String>, Set<String>> {
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
        for ((key, domains) in WebCategories.CATEGORY_DOMAINS) {
            val action = explicit[key] ?: DEFAULT_CATEGORY_ACTION[key] ?: "allow"
            if (action == "block") blocked.addAll(domains) else allowed.addAll(domains)
        }
        return blocked to allowed
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

    private fun reportEnforcementState(context: Context, deviceId: String, state: Map<String, Any?>) {
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
        SupabaseRest.patch(context, "pc_devices", "id=eq.$deviceId", body)
    }

    private fun isoTimestamp(epochMillis: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(epochMillis))
    }
}
