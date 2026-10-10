package com.surabhikunj.voice.dpc

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * The pure, Context-free half of the policy engine: time windows, limits,
 * "until when", geofence hysteresis. Kept separate from PolicyEnforcer so it
 * is unit-tested on the JVM (src/test/.../PolicyRulesTest.kt) — the
 * behaviour children and parents actually feel lives here.
 *
 * Mirrors src/lib/policy.js / src/lib/screenTimePolicy.js.
 */
object PolicyRules {
    val SCHEDULE_SEVERITY = mapOf(
        "block_all" to 3,
        "allow_list_only" to 2,
        "block_internet" to 1,
    )

    fun parseHm(value: String?): Int? {
        if (value == null) return null
        val m = Regex("^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$").find(value.trim()) ?: return null
        val h = m.groupValues[1].toIntOrNull() ?: return null
        val min = m.groupValues[2].toIntOrNull() ?: return null
        if (h > 23 || min > 59) return null
        return h * 60 + min
    }

    /** [start, end) in minutes of the day; end < start means the window crosses midnight. */
    fun isTimeInRange(start: String?, end: String?, nowMin: Int): Boolean {
        val s = parseHm(start) ?: return false
        val e = parseHm(end) ?: return false
        if (s == e) return false
        return if (e < s) nowMin >= s || nowMin < e else nowMin >= s && nowMin < e
    }

    private fun dow(c: Calendar) = c.get(Calendar.DAY_OF_WEEK) - 1 // Calendar.SUNDAY=1 -> JS getDay()=0

    private fun hasDay(days: JSONArray, day: Int): Boolean {
        for (i in 0 until days.length()) if (days.optInt(i, -1) == day) return true
        return false
    }

    /**
     * Whether a routine is in force at `now`. A window that crosses midnight
     * belongs to the day it STARTS on: "Bedtime, Mon–Fri, 22:00–06:00" is on
     * at 02:00 on Saturday (Friday night) but not at 02:00 on Monday (Sunday
     * night). The earlier check used the CURRENT day for the after-midnight
     * part, which got both of those wrong.
     */
    fun isScheduleActive(schedule: JSONObject, now: Calendar): Boolean {
        if (!schedule.optBoolean("is_enabled", true)) return false
        val days = schedule.optJSONArray("days_of_week") ?: return false
        val s = parseHm(schedule.optString("start_time")) ?: return false
        val e = parseHm(schedule.optString("end_time")) ?: return false
        if (s == e) return false
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val today = dow(now)
        if (e > s) return hasDay(days, today) && nowMin >= s && nowMin < e
        if (nowMin >= s) return hasDay(days, today)
        if (nowMin < e) return hasDay(days, (today + 6) % 7)
        return false
    }

    /** Most restrictive active routine; ties broken by id so the result is stable. */
    fun findActiveSchedule(schedules: JSONArray, now: Calendar, bonusActive: Boolean): JSONObject? {
        if (bonusActive) return null
        var best: JSONObject? = null
        var bestSeverity = -1
        for (i in 0 until schedules.length()) {
            val s = schedules.optJSONObject(i) ?: continue
            if (!isScheduleActive(s, now)) continue
            val severity = SCHEDULE_SEVERITY[s.optString("action")] ?: 0
            if (severity > bestSeverity || (severity == bestSeverity && best != null && s.optString("id") < best.optString("id"))) {
                best = s
                bestSeverity = severity
            }
        }
        return best
    }

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

    /**
     * Per-app limit for `dow`; null = no limit that day. A per-weekday value
     * of 0 means "blocked that day"; a base of 0/negative means "no limit"
     * (matches policy.js invalid_limit).
     */
    fun appLimitForDay(rule: JSONObject, dow: Int): Int? {
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
        val hours = cells.optJSONArray(dow(now).toString()) ?: return false
        val hour = now.get(Calendar.HOUR_OF_DAY)
        for (i in 0 until hours.length()) if (hours.optInt(i, -1) == hour) return true
        return false
    }

    /** When an active routine ends (epoch ms) — tomorrow morning for a cross-midnight one already running. */
    fun scheduleEndsAt(schedule: JSONObject, now: Calendar): Long {
        val end = parseHm(schedule.optString("end_time")) ?: return 0L
        val start = parseHm(schedule.optString("start_time")) ?: return 0L
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val c = now.clone() as Calendar
        c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        c.set(Calendar.HOUR_OF_DAY, end / 60); c.set(Calendar.MINUTE, end % 60)
        if (end < start && nowMin >= start || end <= nowMin) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    /** First whole hour at or after the next hour that is not a restricted cell (searches one week). */
    fun restrictedEndsAt(restricted: JSONObject?, now: Calendar): Long {
        val c = now.clone() as Calendar
        c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        for (i in 0 until 24 * 7) {
            c.add(Calendar.HOUR_OF_DAY, 1)
            if (!isRestrictedNow(restricted, c)) return c.timeInMillis
        }
        return 0L
    }

    fun nextLocalMidnight(now: Calendar): Long {
        val c = now.clone() as Calendar
        c.add(Calendar.DAY_OF_YEAR, 1)
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /**
     * Geofence state with hysteresis. Returns the new inside/outside state,
     * or null when this fix is too imprecise to say anything about a place
     * this size. Arrive only clearly inside, leave only clearly outside; in
     * the band around the edge the previous state stands, so GPS wobble at
     * the boundary no longer fires Arrived / Left / Arrived.
     */
    fun geofenceInside(distanceM: Double, radiusM: Double, accuracyM: Double, wasInside: Boolean?): Boolean? {
        if (accuracyM > maxOf(150.0, radiusM * 2)) return null
        val margin = minOf(maxOf(accuracyM, 20.0), radiusM * 0.5)
        return when {
            distanceM <= radiusM - margin -> true
            distanceM > radiusM + margin -> false
            else -> wasInside ?: (distanceM <= radiusM)
        }
    }
}
