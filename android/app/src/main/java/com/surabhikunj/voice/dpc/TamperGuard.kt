package com.surabhikunj.voice.dpc

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject

/**
 * TamperGuard
 *
 * Detects the moment Accessibility or Device Admin gets turned OFF on a
 * device that had it ON before (a real tamper event — never fires just
 * because setup hasn't been completed yet, see VoiceKidsPrefs's
 * accessibilityWasEnabled/deviceAdminWasActive doc comments), and reacts:
 *
 *   1. Writes a critical pc_alerts row so the parent is notified
 *      immediately (native SupabaseRest — independent of the WebView).
 *   2. Shows a persistent, hard-to-dismiss notification on the child's
 *      device explaining supervision was disabled and it's been reported.
 *   3. Best-effort locks the screen (DpcActions.lockDevice) as an
 *      immediate deterrent — this is the user's explicitly chosen
 *      response, not just an alert. May fail if Device Admin itself is
 *      what just got disabled (lockNow() requires it); that failure is
 *      expected and not itself re-reported.
 *
 * IMPORTANT — honest limits: Android gives no app a way to truly PREVENT
 * a determined user from disabling either permission outside of full
 * Device Owner mode. This is detection + reaction, not prevention. See
 * PLATFORM_LIMITATIONS.md "Tamper detection" section.
 *
 * Called from two places:
 *   - VoiceKidsMonitorService's policy-enforcement tick (steady-state
 *     polling fallback — catches it within POLICY_ENFORCE_INTERVAL_MS
 *     even if the ContentObserver below is ever missed/delayed).
 *   - VoiceKidsMonitorService's ContentObserver on
 *     Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES (near-instant
 *     reaction to the Accessibility toggle specifically).
 *   - VoiceKidsDeviceAdminReceiver.onDisabled() (fires exactly when Device
 *     Admin deactivation happens).
 */
object TamperGuard {
    private const val TAG = "VoiceKidsTamper"
    private const val CHANNEL_ID = "voice_kids_tamper"
    private const val NOTIF_ID = 9001

    // Once alerted, don't re-alert for the SAME still-off kind more than
    // once per window — otherwise a device sitting with Accessibility off
    // would spam pc_alerts every enforcement tick forever.
    private const val REMINDER_COOLDOWN_MS = 15 * 60 * 1000L

    // Kinds that cut core supervision: critical alert + protective lock.
    // The others degrade one feature: warning alert, no lock.
    private val CRITICAL = setOf("accessibility_disabled", "device_admin_disabled")
    private const val WARNING_REMINDER_MS = 60 * 60 * 1000L

    /** Call every enforcement tick — cheap, no-ops when every permission is fine. */
    fun check(context: Context) {
        var anyOff = false
        anyOff = checkOne(
            context,
            kind = "accessibility_disabled",
            currentlyOk = AccessibilityStatus.isEnabled(context),
            wasOk = VoiceKidsPrefs.accessibilityWasEnabled(context),
            setWasOk = { VoiceKidsPrefs.setAccessibilityWasEnabled(context, it) },
        ) || anyOff
        anyOff = checkOne(
            context,
            kind = "device_admin_disabled",
            currentlyOk = DpcActions.isDeviceAdmin(context),
            wasOk = VoiceKidsPrefs.deviceAdminWasActive(context),
            setWasOk = { VoiceKidsPrefs.setDeviceAdminWasActive(context, it) },
        ) || anyOff
        anyOff = checkGeneric(context, "usage_access_disabled", UsageStatsHelper.hasUsageAccess(context)) || anyOff
        // Only a tamper if the parent actually relies on the tunnel.
        if (VoiceKidsPrefs.useVpnFiltering(context)) {
            anyOff = checkGeneric(context, "vpn_disabled", DpcActions.hasVpnConsent(context)) || anyOff
        }
        val hasLocation = context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        anyOff = checkGeneric(context, "location_disabled", hasLocation) || anyOff
        // Everything back on: clear the child-side warning (it used to stay forever).
        if (!anyOff) clearNotification(context)
    }

    private fun checkGeneric(context: Context, kind: String, currentlyOk: Boolean): Boolean {
        val key = "was_ok:$kind"
        return checkOne(context, kind, currentlyOk, VoiceKidsPrefs.getLong(context, key) != 0L) {
            VoiceKidsPrefs.putLong(context, key, if (it) 1L else 0L)
        }
    }

    /** @return true when this permission is currently off after having been on. */
    private fun checkOne(context: Context, kind: String, currentlyOk: Boolean, wasOk: Boolean, setWasOk: (Boolean) -> Unit): Boolean {
        if (currentlyOk) {
            if (!wasOk) setWasOk(true)
            if (VoiceKidsPrefs.getLong(context, "tamper_open:$kind") != 0L) {
                // Restored: tell the parent protection is back, once.
                VoiceKidsPrefs.putLong(context, "tamper_open:$kind", 0L)
                VoiceKidsPrefs.setLastTamperAlertAt(context, kind, 0L)
                Outbox.alert(context, "tamper_detected", "info", restoredTitle(kind),
                    "It was turned back on.", JSONObject().put("kind", kind).put("restored", true))
            }
            return false
        }
        if (!wasOk) return false // setup was never completed — not tampering, just not set up yet
        reportTamper(context, kind)
        return true
    }

    /** Public so VoiceKidsDeviceAdminReceiver.onDisabled() can react immediately, not wait for the next poll tick. */
    fun reportTamper(context: Context, kind: String) {
        val now = System.currentTimeMillis()
        val last = VoiceKidsPrefs.lastTamperAlertAt(context, kind)
        val cooldown = if (kind in CRITICAL) REMINDER_COOLDOWN_MS else WARNING_REMINDER_MS
        if (last != 0L && now - last < cooldown) return
        VoiceKidsPrefs.setLastTamperAlertAt(context, kind, now)
        VoiceKidsPrefs.putLong(context, "tamper_open:$kind", now)

        Log.w(TAG, "Tamper detected: $kind")
        sendAlert(context, kind)
        showPersistentNotification(context, kind)
        if (kind !in CRITICAL) return
        // Best-effort deterrent (user's explicit choice: alert + auto-lock).
        // May legitimately fail if Device Admin is what just got disabled.
        try {
            DpcActions.lockDevice(context)
        } catch (e: Exception) {
            Log.w(TAG, "lockDevice during tamper response failed (expected if admin was revoked): ${e.message}")
        }
    }

    private fun sendAlert(context: Context, kind: String) {
        val (title, body) = messageFor(kind)
        // Outbox: switching supervision off in aeroplane mode no longer
        // goes unreported — it is delivered when the phone reconnects.
        Outbox.alert(context, "tamper_detected", if (kind in CRITICAL) "critical" else "warning", title, body,
            JSONObject().put("kind", kind))
    }

    private fun restoredTitle(kind: String): String = when (kind) {
        "accessibility_disabled" -> "Supervision is back on"
        "device_admin_disabled" -> "Device admin is back on"
        "usage_access_disabled" -> "Usage access is back on"
        "vpn_disabled" -> "Web protection is back on"
        "location_disabled" -> "Location is back on"
        else -> "Protection restored"
    }

    private fun messageFor(kind: String): Pair<String, String> = when (kind) {
        "accessibility_disabled" -> "Supervision was turned off" to
            "VOICE's Accessibility permission was turned off. App blocking, routines and website filtering have stopped until it's turned back on."
        "device_admin_disabled" -> "Device admin was turned off" to
            "VOICE's Device admin permission was turned off. Lock now and remote wipe won't work until it's turned back on."
        "usage_access_disabled" -> "Usage access was turned off" to
            "Screen-time limits and app limits have stopped, and usage reports are paused, until Usage access is turned back on."
        "vpn_disabled" -> "Web protection was turned off" to
            "The VOICE web-protection VPN was switched off or replaced by another VPN. Safe Search and filtering in apps have stopped."
        "location_disabled" -> "Location permission was removed" to
            "Location and place alerts have stopped until location access is allowed again."
        else -> "Supervision was turned off" to "A parental-control permission was disabled on this device."
    }

    private fun clearNotification(context: Context) {
        runCatching { context.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID) }
    }

    private fun showPersistentNotification(context: Context, kind: String) {
        ensureChannel(context)

        val settingsAction = when (kind) {
            "accessibility_disabled" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "usage_access_disabled" -> Settings.ACTION_USAGE_ACCESS_SETTINGS
            "location_disabled" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            else -> Settings.ACTION_SECURITY_SETTINGS
        }
        val intent = Intent(settingsAction).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (settingsAction == Settings.ACTION_APPLICATION_DETAILS_SETTINGS) {
            intent.data = android.net.Uri.fromParts("package", context.packageName, null)
        }
        val contentIntent = PendingIntent.getActivity(context, 0, intent, pendingIntentFlags())

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(context)
        }
        val (title, _) = messageFor(kind)
        val notification = builder
            .setContentTitle(title)
            .setContentText("This has been reported to your parent. Tap to turn it back on.")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(NOTIF_ID, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "VOICE supervision alerts",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Warns when a parental-control permission is turned off"
        }
        manager.createNotificationChannel(channel)
    }

    private fun pendingIntentFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        else PendingIntent.FLAG_UPDATE_CURRENT
}
