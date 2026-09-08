package com.surabhikunj.voice.dpc

import android.content.Context
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
 * BlockOverlay — brief full-screen "This app is blocked" message shown right
 * after VoiceKidsAccessibilityService kicks a disallowed foreground app back
 * to home. Purely cosmetic/explanatory: performGlobalAction(GLOBAL_ACTION_HOME)
 * already did the actual blocking before this ever runs. If the parent hasn't
 * granted the "Draw over other apps" permission, show() just no-ops — the
 * home-kick alone is still a real, working block, just without the
 * explanation shown to the child.
 */
object BlockOverlay {
    private const val TAG = "VoiceKidsBlockOverlay"
    private const val AUTO_DISMISS_MS = 2000L

    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentView: android.view.View? = null

    fun show(context: Context) {
        if (!DpcActions.canDrawOverlays(context)) return
        mainHandler.post { showInternal(context.applicationContext) }
    }

    private fun showInternal(context: Context) {
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
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                android.graphics.PixelFormat.TRANSLUCENT,
            )

            val layout = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor("#CC1A1030"))
            }
            val icon = TextView(context).apply {
                text = "\uD83D\uDEAB"
                textSize = 48f
                gravity = Gravity.CENTER
            }
            val label = TextView(context).apply {
                text = "This app is blocked by Parental Control"
                setTextColor(Color.WHITE)
                textSize = 18f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(48, 24, 48, 0)
            }
            layout.addView(icon)
            layout.addView(label)

            windowManager.addView(layout, params)
            currentView = layout

            mainHandler.postDelayed({ dismissInternal(context) }, AUTO_DISMISS_MS)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to show block overlay: ${e.message}")
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
