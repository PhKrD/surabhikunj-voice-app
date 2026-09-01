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

        val bonusActive = VoiceKidsPrefs.isBonusActive(context)
        val now = Calendar.getInstance()

        val activeSchedule = findActiveSchedule(schedules, now, bonusActive)
        val usageAvailable = UsageStatsHelper.hasUsageAccess(context)
        val usageByPackage: Map<String, Long> = if (usageAvailable) {
            UsageStatsHelper.queryTodayUsage(context).associate { it.packageName to it.totalForegroundMs }
        } else emptyMap()

        val (blockList, allowList) = resolveAppRules(rules, usageByPackage, usageAvailable, bonusActive)

        val signature = "${activeSchedule?.optString("id")}|${activeSchedule?.optString("action")}|" +
            "${blockList.sorted()}|${allowList.sorted()}"
        val appliedSignature = VoiceKidsPrefs.appliedSignature(context)
        val appliedScheduleLock = VoiceKidsPrefs.appliedScheduleLock(context)

        if (signature == appliedSignature && activeSchedule == null && !appliedScheduleLock) {
            return // nothing changed since the last successful pass
        }

        if (!DpcActions.isDeviceOwner(context)) {
            reportEnforcementState(context, deviceId, mapOf(
                "device_owner" to false,
                "usage_access" to usageAvailable,
                "desired_blocked" to JSONArray(blockList),
                "suspended_count" to 0,
                "last_error" to "not_device_owner",
            ))
            return
        }

        var ok = true

        // ── Schedule-level enforcement ──────────────────────────────────
        if (activeSchedule != null) {
            val action = activeSchedule.optString("action")
            when (action) {
                "block_all" -> {
                    val allowed = jsonStringArray(activeSchedule.optJSONArray("always_allowed_packages"))
                    ok = if (allowed.isNotEmpty()) DpcActions.setAllowedPackages(context, allowed)
                         else DpcActions.lockDevice(context)
                }
                "block_internet" -> ok = DpcActions.pauseInternet(context)
                "allow_list_only" -> {
                    val allowed = jsonStringArray(activeSchedule.optJSONArray("always_allowed_packages"))
                    ok = DpcActions.setAllowedPackages(context, allowed)
                }
            }
            VoiceKidsPrefs.setAppliedScheduleLock(context, true)
        } else if (appliedScheduleLock) {
            DpcActions.unlockDevice(context)
            DpcActions.resumeInternet(context)
            VoiceKidsPrefs.setAppliedScheduleLock(context, false)
        }

        // ── Per-app reconciliation ──────────────────────────────────────
        val appliedSuspended = VoiceKidsPrefs.appliedSuspended(context)
        val desiredSet = blockList.filterNot { isProtectedPackage(it) }.toSet()
        val toSuspend = (desiredSet - appliedSuspended).toList()
        val toUnsuspend = (appliedSuspended - desiredSet).filterNot { isProtectedPackage(it) }

        var suspendOk = true
        if (toSuspend.isNotEmpty()) {
            val failed = DpcActions.setPackagesSuspended(context, toSuspend, true)
            suspendOk = failed != null
        }
        var unsuspendOk = true
        if (toUnsuspend.isNotEmpty()) {
            val failed = DpcActions.setPackagesSuspended(context, toUnsuspend, false)
            unsuspendOk = failed != null
        }

        val settled = suspendOk && unsuspendOk && ok
        if (settled) {
            VoiceKidsPrefs.setAppliedSuspended(context, desiredSet)
            VoiceKidsPrefs.setAppliedSignature(context, signature)
        } else {
            VoiceKidsPrefs.setAppliedSignature(context, null) // force retry next tick
        }

        reportEnforcementState(context, deviceId, mapOf(
            "device_owner" to true,
            "usage_access" to usageAvailable,
            "active_schedule" to (activeSchedule?.optString("name")),
            "suspended_count" to (if (settled) desiredSet.size else appliedSuspended.size),
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
