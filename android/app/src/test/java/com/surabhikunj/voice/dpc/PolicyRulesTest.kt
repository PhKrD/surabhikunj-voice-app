package com.surabhikunj.voice.dpc

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * JVM tests for the native engine's time and place decisions — the code
 * that actually runs on the child's phone (PolicyRules.kt).
 */
class PolicyRulesTest {

    private val tz = TimeZone.getTimeZone("Asia/Kolkata")

    /** dow: 0 = Sunday … 6 = Saturday, as stored in pc_schedules.days_of_week. */
    private fun at(dow: Int, hour: Int, minute: Int = 0): Calendar {
        // 2026-01-04 is a Sunday.
        return Calendar.getInstance(tz).apply {
            clear()
            set(2026, Calendar.JANUARY, 4 + dow, hour, minute, 0)
        }
    }

    private fun schedule(days: List<Int>, start: String, end: String, action: String = "block_all", id: String = "a") =
        JSONObject().put("id", id).put("days_of_week", JSONArray(days)).put("start_time", start)
            .put("end_time", end).put("action", action).put("is_enabled", true)

    private val weeknights = listOf(1, 2, 3, 4, 5) // Mon–Fri

    @Test fun bedtimeStartsAndEndsOnTime() {
        val bed = schedule(weeknights, "22:30", "06:00")
        assertFalse(PolicyRules.isScheduleActive(bed, at(1, 22, 29)))
        assertTrue(PolicyRules.isScheduleActive(bed, at(1, 22, 30)))
        assertTrue(PolicyRules.isScheduleActive(bed, at(2, 5, 59)))
        assertFalse(PolicyRules.isScheduleActive(bed, at(2, 6, 0)))
    }

    @Test fun crossMidnightBelongsToTheNightItStarts() {
        val bed = schedule(weeknights, "22:00", "06:00")
        // Friday night continues into Saturday morning…
        assertTrue(PolicyRules.isScheduleActive(bed, at(6, 2, 0)))
        // …but Sunday night (not selected) does not lock Monday 2 AM.
        assertFalse(PolicyRules.isScheduleActive(bed, at(1, 2, 0)))
        // Monday night does lock Tuesday 2 AM.
        assertTrue(PolicyRules.isScheduleActive(bed, at(2, 2, 0)))
    }

    @Test fun sameDayWindowAndEdgeCases() {
        val study = schedule(listOf(1), "16:00", "18:00", "allow_list_only")
        assertTrue(PolicyRules.isScheduleActive(study, at(1, 16, 0)))
        assertFalse(PolicyRules.isScheduleActive(study, at(1, 18, 0)))
        assertFalse(PolicyRules.isScheduleActive(study, at(2, 17, 0)))
        assertFalse(PolicyRules.isScheduleActive(schedule(listOf(1), "16:00", "16:00"), at(1, 16, 0)))
        assertFalse(PolicyRules.isScheduleActive(schedule(listOf(1), "25:00", "18:00"), at(1, 17, 0)))
        assertFalse(PolicyRules.isScheduleActive(study.put("is_enabled", false), at(1, 17, 0)))
        assertTrue(PolicyRules.isScheduleActive(schedule(listOf(1), "16:00:00", "18:00:00"), at(1, 17, 0)))
    }

    @Test fun mostRestrictiveRoutineWinsAndExtraTimeSuspendsRoutines() {
        val all = JSONArray()
            .put(schedule(listOf(1), "16:00", "20:00", "block_internet", "b"))
            .put(schedule(listOf(1), "17:00", "19:00", "block_all", "c"))
            .put(schedule(listOf(1), "16:00", "20:00", "allow_list_only", "a"))
        assertEquals("c", PolicyRules.findActiveSchedule(all, at(1, 18, 0), false)?.optString("id"))
        assertEquals("a", PolicyRules.findActiveSchedule(all, at(1, 16, 30), false)?.optString("id"))
        assertNull(PolicyRules.findActiveSchedule(all, at(1, 18, 0), true))
    }

    @Test fun dailyLimitByWeekday() {
        val rule = JSONObject().put("is_enabled", true).put("daily_limit_min", 120)
            .put("daily_limits_by_dow", JSONObject().put("6", 240).put("0", JSONObject.NULL).put("3", 0))
        assertEquals(120, PolicyRules.limitForDay(rule, 1))
        assertEquals(240, PolicyRules.limitForDay(rule, 6))
        assertEquals(120, PolicyRules.limitForDay(rule, 0)) // null override → base
        assertEquals(0, PolicyRules.limitForDay(rule, 3))   // 0 is a real limit
        assertNull(PolicyRules.limitForDay(rule.put("is_enabled", false), 1))
        assertNull(PolicyRules.limitForDay(null, 1))
    }

    @Test fun appLimitZeroOnADayBlocksButZeroBaseMeansNoLimit() {
        val rule = JSONObject().put("daily_limit_min", 60).put("daily_limits_by_dow", JSONObject().put("1", 0))
        assertEquals(0, PolicyRules.appLimitForDay(rule, 1))
        assertEquals(60, PolicyRules.appLimitForDay(rule, 2))
        assertNull(PolicyRules.appLimitForDay(JSONObject().put("daily_limit_min", 0), 2))
    }

    @Test fun restrictedTimesAndWhenTheyEnd() {
        val r = JSONObject().put("is_enabled", true)
            .put("cells", JSONObject().put("1", JSONArray(listOf(21, 22, 23))).put("2", JSONArray(listOf(0, 1))))
        assertTrue(PolicyRules.isRestrictedNow(r, at(1, 21, 15)))
        assertFalse(PolicyRules.isRestrictedNow(r, at(1, 20, 59)))
        // Monday 21:15 → runs through to Tuesday 02:00.
        val end = Calendar.getInstance(tz).apply { timeInMillis = PolicyRules.restrictedEndsAt(r, at(1, 21, 15)) }
        assertEquals(2, end.get(Calendar.DAY_OF_WEEK) - 1)
        assertEquals(2, end.get(Calendar.HOUR_OF_DAY))
    }

    @Test fun scheduleEndForCrossMidnightIsTomorrowMorning() {
        val bed = schedule(weeknights, "22:00", "06:00")
        val end = Calendar.getInstance(tz).apply { timeInMillis = PolicyRules.scheduleEndsAt(bed, at(1, 23, 0)) }
        assertEquals(2, end.get(Calendar.DAY_OF_WEEK) - 1)
        assertEquals(6, end.get(Calendar.HOUR_OF_DAY))
        val early = Calendar.getInstance(tz).apply { timeInMillis = PolicyRules.scheduleEndsAt(bed, at(2, 3, 0)) }
        assertEquals(2, early.get(Calendar.DAY_OF_WEEK) - 1)
        assertEquals(6, early.get(Calendar.HOUR_OF_DAY))
    }

    @Test fun dailyResetIsLocalMidnight() {
        val m = Calendar.getInstance(tz).apply { timeInMillis = PolicyRules.nextLocalMidnight(at(3, 23, 59)) }
        assertEquals(4, m.get(Calendar.DAY_OF_WEEK) - 1)
        assertEquals(0, m.get(Calendar.HOUR_OF_DAY))
        assertEquals(0, m.get(Calendar.MINUTE))
    }

    @Test fun geofenceHysteresisIgnoresBoundaryWobble() {
        // 100 m radius, 20 m accuracy → margin 20 m: in ≤ 80 m, out > 120 m.
        assertEquals(true, PolicyRules.geofenceInside(70.0, 100.0, 20.0, false))
        assertEquals(false, PolicyRules.geofenceInside(110.0, 100.0, 20.0, false))
        assertEquals(true, PolicyRules.geofenceInside(110.0, 100.0, 20.0, true))   // wobble: stays inside
        assertEquals(false, PolicyRules.geofenceInside(90.0, 100.0, 20.0, false))  // wobble: stays outside
        assertEquals(false, PolicyRules.geofenceInside(130.0, 100.0, 20.0, true))
        assertEquals(true, PolicyRules.geofenceInside(95.0, 100.0, 20.0, null))    // first reading: plain test
    }

    @Test fun geofenceIgnoresFixesTooVagueForThePlace() {
        assertNull(PolicyRules.geofenceInside(10.0, 50.0, 400.0, false))
        assertEquals(true, PolicyRules.geofenceInside(10.0, 500.0, 400.0, false))
    }
}
