package com.surabhikunj.voice.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver
 * Restarts the monitoring foreground service after the device reboots,
 * as long as the device has already completed enrollment (a session is
 * cached in VoiceKidsPrefs). If not enrolled yet, does nothing — the
 * service itself would also no-op/self-stop in that case.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && VoiceKidsPrefs.isConfigured(context)) {
            Log.i(TAG, "Boot completed — restarting monitor service")
            val serviceIntent = Intent(context, VoiceKidsMonitorService::class.java)
            context.startForegroundService(serviceIntent)
        }
    }

    companion object {
        private const val TAG = "VoiceKidsBootReceiver"
    }
}
