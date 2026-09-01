package com.surabhikunj.voice.dpc

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * VoiceKidsUsageStatsPlugin
 *
 * JS-facing access to screen-time data for the child's own "Screen time
 * today" widget (HomePage.jsx). The periodic reporting to
 * pc_app_usage_events / pc_installed_apps happens natively in
 * VoiceKidsMonitorService regardless of whether the JS layer ever calls
 * this plugin — this is purely for immediate UI feedback.
 */
@CapacitorPlugin(name = "VoiceKidsUsageStats")
class VoiceKidsUsageStatsPlugin : Plugin() {

    @PluginMethod
    fun hasUsageAccess(call: PluginCall) {
        val result = JSObject()
        result.put("granted", UsageStatsHelper.hasUsageAccess(context))
        call.resolve(result)
    }

    /** Opens Settings > Apps > Special app access > Usage access so the parent can grant it once. */
    @PluginMethod
    fun openUsageAccessSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        intent.data = Uri.parse("package:${context.packageName}")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve(successResult())
        } catch (e: Exception) {
            // Some OEMs don't support the package: data URI — fall back to the bare screen.
            try {
                context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve(successResult())
            } catch (e2: Exception) {
                call.reject("Could not open usage access settings: ${e2.message}")
            }
        }
    }

    /** Returns today's total foreground minutes + a per-app breakdown, for the child's own UI. */
    @PluginMethod
    fun getTodayUsage(call: PluginCall) {
        val usage = UsageStatsHelper.queryTodayUsage(context)
        val apps = JSArray()
        var totalMs = 0L

        usage.forEach { u ->
            totalMs += u.totalForegroundMs
            val item = JSObject()
            item.put("packageName", u.packageName)
            item.put("appName", u.appName)
            item.put("totalForegroundMs", u.totalForegroundMs)
            apps.put(item)
        }

        val result = JSObject()
        result.put("totalForegroundMs", totalMs)
        result.put("totalForegroundMinutes", totalMs / 60_000)
        result.put("apps", apps)
        call.resolve(result)
    }

    /**
     * Returns the bare list of currently-installed package names. Used by
     * ruleEngine.js as the authoritative source of truth during a full
     * reconcile pass: any package suspended on-device that is NOT in the
     * desired block list gets released, even if the JS layer's local cache
     * of "what we suspended" was lost (app data cleared, reinstall, upgrade
     * from a build without enforcementStore.js).
     *
     * Deliberately includes system-flagged apps: on most OEM images Chrome,
     * YouTube and Gmail are preinstalled with FLAG_SYSTEM set yet are fully
     * suspendable via setPackagesSuspended() — excluding them would defeat
     * the reconcile sweep for exactly the apps parents block most often.
     * The device-agent's own package and other genuinely unsuspendable
     * packages are protected centrally in policy.js (PROTECTED_PACKAGES),
     * not filtered here.
     *
     * Deliberately a separate, cheap call from syncInstalledApps() (which
     * also upserts full metadata to Supabase) — this one only touches
     * PackageManager and never hits the network.
     */
    @PluginMethod
    fun getInstalledPackages(call: PluginCall) {
        val packages = JSArray()
        UsageStatsHelper.queryInstalledApps(context).forEach { packages.put(it.packageName) }
        val result = JSObject()
        result.put("packages", packages)
        call.resolve(result)
    }

    /** Force sync installed apps to Supabase immediately (bypasses 24h interval). */
    @PluginMethod
    fun syncInstalledApps(call: PluginCall) {
        val deviceId = VoiceKidsPrefs.deviceId(context)
        if (deviceId == null) {
            call.reject("Device not enrolled")
            return
        }

        val rows = org.json.JSONArray()
        UsageStatsHelper.queryInstalledApps(context).forEach { app ->
            val row = org.json.JSONObject().apply {
                put("device_id", deviceId)
                put("package_name", app.packageName)
                put("app_name", app.appName)
                if (app.versionName != null) put("version_name", app.versionName)
                put("is_system_app", app.isSystemApp)
                if (app.installedAt > 0) put("installed_at", isoTimestamp(app.installedAt))
                put("last_seen_at", isoTimestamp(System.currentTimeMillis()))
            }
            rows.put(row)
        }

        val ok = SupabaseRest.upsert(context, "pc_installed_apps", rows, "device_id,package_name")
        val result = JSObject()
        result.put("success", ok)
        result.put("count", rows.length())
        call.resolve(result)
    }

    private fun isoTimestamp(millis: Long): String {
        return java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date(millis))
    }

    private fun successResult(): JSObject {
        val result = JSObject()
        result.put("success", true)
        return result
    }
}
