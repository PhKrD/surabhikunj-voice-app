package com.surabhikunj.voice.dpc

import android.app.AppOpsManager
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

    /** Per-app foreground time for "today so far". Excludes apps with zero usage. */
    fun queryTodayUsage(context: Context): List<AppUsage> {
        if (!hasUsageAccess(context)) return emptyList()

        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val start = startOfToday()
        val end = System.currentTimeMillis()

        val statsMap = usm.queryAndAggregateUsageStats(start, end) ?: return emptyList()
        val pm = context.packageManager

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
