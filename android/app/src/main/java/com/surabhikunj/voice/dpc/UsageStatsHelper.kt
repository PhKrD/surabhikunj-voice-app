package com.surabhikunj.voice.dpc

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import java.util.Calendar

/**
 * UsageStatsHelper
 *
 * Wraps Android's UsageStatsManager + PackageManager so both the
 * Capacitor plugin (foreground, JS-triggered) and the background
 * VoiceKidsMonitorService (no JS) can query app usage / installed apps
 * the same way.
 *
 * PACKAGE_USAGE_STATS is a "special access" permission — it cannot be
 * granted programmatically even by a Device Owner app; the parent must
 * enable it once via Settings > Apps > Special app access > Usage access
 * (openUsageAccessSettings() below opens that screen directly).
 */
object UsageStatsHelper {

    data class AppUsage(
        val packageName: String,
        val appName: String,
        val totalForegroundMs: Long,
        val firstUseAt: Long,
        val lastUseAt: Long,
    )

    data class InstalledApp(
        val packageName: String,
        val appName: String,
        val versionName: String?,
        val isSystemApp: Boolean,
        val installedAt: Long,
    )

    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = try {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        } catch (e: Exception) {
            AppOpsManager.MODE_ERRORED
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Start-of-today (device local time) in epoch millis. */
    private fun startOfToday(): Long {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }

    private class EventTally(val totals: Map<String, Long>, val first: Map<String, Long>, val last: Map<String, Long>)

    /**
     * Foreground time per app since LOCAL midnight, tallied from the raw
     * resume/pause event stream — the same source Digital Wellbeing uses.
     *
     * queryAndAggregateUsageStats() (the previous source) returns whole
     * daily buckets whose boundaries are not local midnight on many phones,
     * so early in the day it could still include yesterday evening: a child
     * could open the phone at 7 AM already "over the limit". Falls back to
     * the aggregate if the event stream is unavailable.
     */
    private fun tallyEvents(context: Context, start: Long, end: Long): EventTally? {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = usm.queryEvents(start, end) ?: return null
        val open = HashMap<String, MutableSet<String>>()
        val openedAt = HashMap<String, Long>()
        val totals = HashMap<String, Long>()
        val first = HashMap<String, Long>()
        val last = HashMap<String, Long>()
        val seen = HashSet<String>()
        val e = UsageEvents.Event()

        fun close(pkg: String, at: Long) {
            val since = openedAt.remove(pkg) ?: return
            open.remove(pkg)
            if (at > since) totals[pkg] = (totals[pkg] ?: 0L) + (at - since)
            last[pkg] = at
        }

        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val pkg = e.packageName ?: continue
            val ts = e.timeStamp
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    val classes = open.getOrPut(pkg) { HashSet() }
                    if (classes.isEmpty()) openedAt[pkg] = ts
                    classes.add(e.className ?: "")
                    if (pkg !in first) first[pkg] = ts
                    seen.add(pkg)
                }
                UsageEvents.Event.ACTIVITY_PAUSED, ACTIVITY_STOPPED -> {
                    val classes = open[pkg]
                    if (classes == null && pkg !in seen) {
                        // In the foreground since before midnight: count from midnight.
                        openedAt[pkg] = start
                        open[pkg] = hashSetOf(e.className ?: "")
                        first[pkg] = start
                    }
                    seen.add(pkg)
                    open[pkg]?.remove(e.className ?: "")
                    if (open[pkg]?.isEmpty() != false) close(pkg, ts)
                }
                SCREEN_NON_INTERACTIVE, DEVICE_SHUTDOWN -> openedAt.keys.toList().forEach { close(it, ts) }
            }
        }
        openedAt.keys.toList().forEach { close(it, end) }
        return EventTally(totals, first, last)
    }

    // Constants not exposed on every API level we compile against.
    private const val ACTIVITY_STOPPED = 23
    private const val SCREEN_NON_INTERACTIVE = 16
    private const val DEVICE_SHUTDOWN = 26

    @Volatile private var cachedUsage: Map<String, Long>? = null
    @Volatile private var cachedUsageAt = 0L
    @Volatile private var cachedUsageDay = 0L
    private const val USAGE_CACHE_MS = 15_000L

    /**
     * package -> foreground ms today, cached briefly. The enforcement pass
     * runs every few seconds; recounting the day's event stream that often
     * would be wasted battery for a number that changes by seconds.
     */
    fun todayUsageCached(context: Context): Map<String, Long> {
        val now = System.currentTimeMillis()
        val day = startOfToday()
        cachedUsage?.let { if (day == cachedUsageDay && now - cachedUsageAt < USAGE_CACHE_MS) return it }
        val map = queryTodayUsage(context).associate { it.packageName to it.totalForegroundMs }
        cachedUsage = map
        cachedUsageAt = now
        cachedUsageDay = day
        return map
    }

    /** Per-app foreground time for "today so far". Excludes apps with zero usage. */
    fun queryTodayUsage(context: Context): List<AppUsage> {
        if (!hasUsageAccess(context)) return emptyList()

        val start = startOfToday()
        val end = System.currentTimeMillis()
        val pm = context.packageManager

        val tally = runCatching { tallyEvents(context, start, end) }.getOrNull()
        if (tally != null) {
            return tally.totals.filter { it.value > 0 }.map { (pkg, ms) ->
                AppUsage(pkg, resolveAppName(pm, pkg), ms, tally.first[pkg] ?: 0L, tally.last[pkg] ?: 0L)
            }
        }

        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val statsMap = usm.queryAndAggregateUsageStats(start, end) ?: return emptyList()
        return statsMap.values
            .filter { it.totalTimeInForeground > 0 }
            .map { stat ->
                AppUsage(
                    packageName = stat.packageName,
                    appName = resolveAppName(pm, stat.packageName),
                    totalForegroundMs = stat.totalTimeInForeground,
                    firstUseAt = stat.firstTimeStamp,
                    lastUseAt = stat.lastTimeUsed,
                )
            }
    }

    fun queryInstalledApps(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        return apps.map { app ->
            val versionName = try {
                pm.getPackageInfo(app.packageName, 0).versionName
            } catch (e: Exception) {
                null
            }
            val installedAt = try {
                pm.getPackageInfo(app.packageName, 0).firstInstallTime
            } catch (e: Exception) {
                0L
            }
            InstalledApp(
                packageName = app.packageName,
                appName = pm.getApplicationLabel(app).toString(),
                versionName = versionName,
                isSystemApp = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0,
                installedAt = installedAt,
            )
        }
    }

    private fun resolveAppName(pm: PackageManager, packageName: String): String {
        return try {
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            packageName
        }
    }
}
