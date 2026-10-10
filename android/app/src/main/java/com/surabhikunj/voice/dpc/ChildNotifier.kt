package com.surabhikunj.voice.dpc

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * "15 minutes left" / "5 minutes left" heads-ups for the child, for the
 * daily screen-time limit and for each app limit. Each threshold fires at
 * most once per day per limit (keyed in prefs), so it can never spam.
 */
object ChildNotifier {
    private const val CHANNEL_ID = "voice_kids_time_left"
    private val THRESHOLDS = listOf(15, 5)

    /** @param key stable id for the limit ("daily" or a package name). */
    fun maybeWarn(context: Context, key: String, label: String, usedMin: Int, limitMin: Int, today: String) {
        if (limitMin <= 0) return
        val left = limitMin - usedMin
        if (left <= 0) return
        val threshold = THRESHOLDS.lastOrNull { left <= it } ?: return
        val prefKey = "warned:$today:$key:$threshold"
        if (VoiceKidsPrefs.getLong(context, prefKey) != 0L) return
        VoiceKidsPrefs.putLong(context, prefKey, System.currentTimeMillis())
        val title = if (key == "daily") "$left min of screen time left" else "$left min left on $label"
        val body = if (key == "daily") "Your daily limit is ${limitMin} min. Save what matters." else "You've used $usedMin of $limitMin minutes today."
        show(context, key.hashCode(), title, body)
    }

    private fun show(context: Context, id: Int, title: String, body: String) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Time remaining", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Heads-up before a screen-time limit is reached"
                },
            )
        }
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        runCatching { nm.notify(7000 + (id and 0xFFF), n) }
    }
}
