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

    /** Call every enforcement tick — cheap, no-ops when both permissions are fine. */
    fun check(context: Context) {
        checkOne(
            context,
            kind = "accessibility_disabled",
            currentlyOk = AccessibilityStatus.isEnabled(context),
            wasOk = VoiceKidsPrefs.accessibilityWasEnabled(context),
            setWasOk = { VoiceKidsPrefs.setAccessibilityWasEnabled(context, it) },
        )
        checkOne(
            context,
            kind = "device_admin_disabled",
            currentlyOk = DpcActions.isDeviceAdmin(context),
            wasOk = VoiceKidsPrefs.deviceAdminWasActive(context),
            setWasOk = { VoiceKidsPrefs.setDeviceAdminWasActive(context, it) },
        )
    }

    private fun checkOne(context: Context, kind: String, currentlyOk: Boolean, wasOk: Boolean, setWasOk: (Boolean) -> Unit) {
        if (currentlyOk) {
            setWasOk(true)
            return
        }
        if (!wasOk) return // setup was never completed — not tampering, just not set up yet
        reportTamper(context, kind)
    }

    /** Public so VoiceKidsDeviceAdminReceiver.onDisabled() can react immediately, not wait for the next poll tick. */
    fun reportTamper(context: Context, kind: String) {
        val now = System.currentTimeMillis()
        val last = VoiceKidsPrefs.lastTamperAlertAt(context, kind)
        if (last != 0L && now - last < REMINDER_COOLDOWN_MS) return
        VoiceKidsPrefs.setLastTamperAlertAt(context, kind, now)

        Log.w(TAG, "Tamper detected: $kind")
        sendAlert(context, kind)
        showPersistentNotification(context, kind)
        // Best-effort deterrent (user's explicit choice: alert + auto-lock).
        // May legitimately fail if Device Admin is what just got disabled.
        try {
            DpcActions.lockDevice(context)
        } catch (e: Exception) {
            Log.w(TAG, "lockDevice during tamper response failed (expected if admin was revoked): ${e.message}")
        }
    }

    private fun sendAlert(context: Context, kind: String) {
        val childId = VoiceKidsPrefs.childId(context) ?: return
        val deviceId = VoiceKidsPrefs.deviceId(context)
        val (title, body) = messageFor(kind)

        val alert = JSONObject().apply {
            put("child_id", childId)
            if (deviceId != null) put("device_id", deviceId)
            put("alert_type", "tamper_detected")
            put("severity", "critical")
            put("title", title)
            put("body", body)
            put("metadata", JSONObject().put("kind", kind))
        }
        val ok = SupabaseRest.insert(context, "pc_alerts", alert)
        if (!ok) Log.e(TAG, "Failed to report tamper alert for $kind — parent will not be notified server-side")
    }

    private fun messageFor(kind: String): Pair<String, String> = when (kind) {
        "accessibility_disabled" -> "Supervision was turned off" to
            "VOICE's Accessibility permission was turned off on this device — app blocking and monitoring have stopped working until it's re-enabled."
        "device_admin_disabled" -> "Device admin was turned off" to
            "VOICE's Device Admin permission was turned off on this device — screen lock and some controls have stopped working until it's re-activated."
        else -> "Supervision was turned off" to "A parental-control permission was disabled on this device."
    }

    private fun showPersistentNotification(context: Context, kind: String) {
        ensureChannel(context)

        val settingsAction = if (kind == "accessibility_disabled") {
            Settings.ACTION_ACCESSIBILITY_SETTINGS
        } else {
            Settings.ACTION_SECURITY_SETTINGS
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(settingsAction).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            pendingIntentFlags(),
        )

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
