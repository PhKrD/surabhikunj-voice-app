package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * BlockOverlay — full-screen explanation shown right after
 * VoiceKidsAccessibilityService kicks a disallowed foreground app back to
 * home. Purely cosmetic/explanatory: performGlobalAction(GLOBAL_ACTION_HOME)
 * already did the actual blocking before this ever runs. If the parent hasn't
 * granted the "Draw over other apps" permission, show() just no-ops — the
 * home-kick alone is still a real, working block, just without the
 * explanation shown to the child.
 *
 * The wording is contextual (mirrors src/lib/screenTimePolicy.js
 * LOCK_REASON_COPY): "Time's up for today" for a daily limit, "Not now" for a
 * restricted-time cell, "Screen time paused" for a schedule, and "<App> is
 * blocked" for a plain per-app rule. Tapping the overlay opens VOICE so the
 * child lands on the matching lock screen with its "Ask for more time" and
 * SOS buttons — the same flow Qustodio's on-device block screen offers.
 */
object BlockOverlay {
    private const val TAG = "VoiceKidsBlockOverlay"
    private const val AUTO_DISMISS_MS = 3500L

    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentView: android.view.View? = null

    fun show(context: Context, reason: String = "app_blocked", appLabel: String? = null) {
        if (!DpcActions.canDrawOverlays(context)) return
        mainHandler.post { showInternal(context.applicationContext, reason, appLabel) }
    }

    private fun copyFor(reason: String, appLabel: String?): Triple<String, String, String> = when (reason) {
        "daily_limit" -> Triple("\u23F0", "Time's up for today", "You've used all of today's screen time.\nTap here to ask your parents for more.")
        "restricted_time" -> Triple("\uD83C\uDF19", "Not now", "This is a restricted time set by your parents.\nTap here to ask for an exception.")
        "schedule" -> Triple("\u23F8", "Screen time paused", "Your parents have scheduled a break.\nTap here to ask for more time.")
        "parent_lock" -> Triple("\uD83D\uDD12", "Locked by your parents", "Your parents locked this device for now.")
        "internet_paused" -> Triple("\uD83D\uDCF6", "Internet is paused", "Your parents paused the internet on this device.\nTap here to ask them to turn it back on.")
        "website_blocked" -> Triple("\uD83C\uDF10", "This site is blocked", "${appLabel ?: "That website"} isn't allowed.\nTap here to ask your parents for access.")
        else -> Triple("\uD83D\uDEAB", "${appLabel ?: "This app"} is blocked", "Your parents have blocked this app.\nTap here to ask for access.")
    }

    private fun showInternal(context: Context, reason: String, appLabel: String?) {
        try {
            dismissInternal(context)

            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
            }

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                android.graphics.PixelFormat.TRANSLUCENT,
            )

            val (emoji, title, body) = copyFor(reason, appLabel)

            val layout = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor("#E61A1030"))
                setOnClickListener {
                    dismissInternal(context)
                    openVoice(context)
                }
            }
            val icon = TextView(context).apply {
                text = emoji
                textSize = 56f
                gravity = Gravity.CENTER
            }
            val label = TextView(context).apply {
                text = title
                setTextColor(Color.WHITE)
                textSize = 22f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(48, 32, 48, 0)
            }
            val detail = TextView(context).apply {
                text = body
                setTextColor(Color.parseColor("#C7C2E0"))
                textSize = 15f
                gravity = Gravity.CENTER
                setPadding(64, 16, 64, 0)
            }
            layout.addView(icon)
            layout.addView(label)
            layout.addView(detail)

            windowManager.addView(layout, params)
            currentView = layout

            mainHandler.postDelayed({ dismissInternal(context) }, AUTO_DISMISS_MS)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to show block overlay: ${e.message}")
        }
    }

    private fun openVoice(context: Context) {
        try {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            context.startActivity(launch)
        } catch (e: Exception) {
            Log.w(TAG, "Could not open VOICE from overlay: ${e.message}")
        }
    }

    private fun dismissInternal(context: Context) {
        val view = currentView ?: return
        try {
            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager.removeView(view)
        } catch (e: Exception) {
            // Already removed / not attached — fine.
        } finally {
            currentView = null
        }
    }
}
