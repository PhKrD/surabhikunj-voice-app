package com.surabhikunj.voice.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * BootReceiver
 * Restarts the monitoring foreground service when supervision would
 * otherwise stay off until someone opened VOICE:
 *   - after a reboot (plus the "quick boot" broadcasts some OEMs send
 *     instead of BOOT_COMPLETED);
 *   - after VOICE itself is updated (MY_PACKAGE_REPLACED) — before this, an
 *     APK update silently ended enforcement on the child's phone.
 * Does nothing on a device that was never paired.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in TRIGGERS || !VoiceKidsPrefs.isConfigured(context)) return
        Log.i(TAG, "${intent.action} — restarting monitor service")
        PolicyEnforcer.invalidateCache()
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, VoiceKidsMonitorService::class.java))
        }.onFailure { Log.e(TAG, "Could not start monitor service: ${it.message}") }
    }

    companion object {
        private const val TAG = "VoiceKidsBootReceiver"
        private val TRIGGERS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }
}
