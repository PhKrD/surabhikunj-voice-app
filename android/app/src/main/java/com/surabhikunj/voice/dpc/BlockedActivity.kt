package com.surabhikunj.voice.dpc

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.concurrent.Executors

/**
 * The child-facing "why can't I use this" screen.
 *
 * Replaces the old 3.5-second overlay, which explained nothing once it faded
 * and needed the optional "draw over other apps" permission. Started by
 * VoiceKidsAccessibilityService the moment a disallowed app comes to the
 * front (an accessibility service may start activities from the background).
 * Being part of VOICE, it is never itself blocked, so it cannot cause the
 * kick-to-home loop.
 *
 * Shows the reason, when it ends, today's usage where relevant, and three
 * ways out that always work: ask for more time (written natively, queued
 * offline), SOS (press-and-hold so a pocket tap can't fire it) and an
 * emergency call. Closes itself as soon as the restriction lifts.
 */
class BlockedActivity : Activity() {

    companion object {
        const val EXTRA_REASON = "reason"
        const val EXTRA_PACKAGE = "package"
        const val EXTRA_LABEL = "label"
        private const val PURPLE = "#6845E0"
        private const val INK = "#1A1030"
        private const val SOS_HOLD_MS = 2000L

        fun intent(context: Context, reason: String, pkg: String?, label: String?): Intent =
            Intent(context, BlockedActivity::class.java)
                .putExtra(EXTRA_REASON, reason)
                .putExtra(EXTRA_PACKAGE, pkg)
                .putExtra(EXTRA_LABEL, label)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }

    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var reason = "app_blocked"
    private var pkg: String? = null
    private var label: String? = null
    private lateinit var root: LinearLayout

    private val stillBlockedCheck = object : Runnable {
        override fun run() {
            if (!isStillRestricted()) {
                Toast.makeText(this@BlockedActivity, "You're good to go", Toast.LENGTH_SHORT).show()
                finish()
                return
            }
            handler.postDelayed(this, 3000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor(INK)
        window.navigationBarColor = Color.parseColor(INK)
        readIntent(intent)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readIntent(intent)
        render()
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(stillBlockedCheck)
        handler.postDelayed(stillBlockedCheck, 3000)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(stillBlockedCheck)
    }

    override fun onDestroy() {
        super.onDestroy()
        io.shutdown()
    }

    // Back must never return to the app that was just blocked.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        goHome()
    }

    private fun readIntent(intent: Intent?) {
        reason = intent?.getStringExtra(EXTRA_REASON) ?: "app_blocked"
        pkg = intent?.getStringExtra(EXTRA_PACKAGE)
        label = intent?.getStringExtra(EXTRA_LABEL)
    }

    private data class Copy(val emoji: String, val title: String, val body: String)

    private fun copy(): Copy {
        val app = label ?: "This app"
        return when (reason) {
            "parent_lock" -> Copy("\uD83D\uDD12", "Phone locked by your parent", "Your parent has locked this phone for now.")
            "schedule" -> {
                val name = VoiceKidsPrefs.lockLabel(this).ifEmpty { "A routine" }
                val emoji = when {
                    name.contains("bed", true) || name.contains("sleep", true) || name.contains("night", true) -> "\uD83C\uDF19"
                    name.contains("study", true) || name.contains("home", true) || name.contains("school", true) -> "\uD83D\uDCDA"
                    else -> "\u23F8\uFE0F"
                }
                Copy(emoji, name, "$name is on. Only the apps your parent allowed can be used right now.")
            }
            "restricted_time" -> Copy("\uD83C\uDF19", "Not right now", "This is a phone-free time set by your parent.")
            "daily_limit" -> Copy("\u23F3", "Daily screen time is up", usageLine() ?: "You've used all of today's screen time.")
            "app_limit" -> Copy("\uD83D\uDCF1", "$app time is up for today", appUsageLine() ?: "You've used all of today's time for $app.")
            "internet_paused" -> Copy("\uD83C\uDF10", "Internet is paused", "Your parent paused the internet. $app needs it, so it can't be used right now.")
            "website_blocked" -> Copy("\uD83D\uDEAB", "This website is blocked", "${label ?: "That website"} isn't allowed by your parent.")
            else -> Copy("\uD83D\uDEAB", "$app is blocked", "$app is blocked by your parent.")
        }
    }

    private fun usageLine(): String? {
        val used = VoiceKidsPrefs.screenTimeTodayMin(this)
        val limit = VoiceKidsPrefs.screenTimeLimitMin(this)
        if (used < 0 || limit < 0) return null
        return "You've used ${formatMinutes(used)} of your ${formatMinutes(limit)} for today."
    }

    private fun appUsageLine(): String? {
        val entry = runCatching { JSONObject(VoiceKidsPrefs.appLimitStatus(this)).optString(pkg ?: "", "") }.getOrNull()
        if (entry.isNullOrEmpty()) return null
        val parts = entry.split("/")
        val used = parts.getOrNull(0)?.toIntOrNull() ?: return null
        val limit = parts.getOrNull(1)?.toIntOrNull() ?: return null
        return "You've used ${formatMinutes(used)} of ${formatMinutes(limit)} today."
    }

    private fun untilLine(): String? {
        val until = when (reason) {
            "daily_limit", "app_limit" -> nextMidnight()
            "parent_lock", "app_blocked", "website_blocked", "internet_paused" -> 0L
            else -> VoiceKidsPrefs.lockUntil(this)
        }
        if (until <= System.currentTimeMillis()) return null
        val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(until))
        val sameDay = Calendar.getInstance().apply { timeInMillis = until }.get(Calendar.DAY_OF_YEAR) ==
            Calendar.getInstance().get(Calendar.DAY_OF_YEAR)
        return if (reason == "daily_limit" || reason == "app_limit") "Resets at midnight"
        else if (sameDay) "Until $time" else "Until $time tomorrow"
    }

    private fun render() {
        timeChoicesShown = false
        val c = copy()
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor(INK))
            isFillViewport = true
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(56), dp(28), dp(32))
        }
        scroll.addView(root)

        root.addView(TextView(this).apply {
            text = c.emoji
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#2A1F4A")) }
            layoutParams = LinearLayout.LayoutParams(dp(104), dp(104)).apply { bottomMargin = dp(24) }
        })
        root.addView(text(c.title, 24f, Color.WHITE, bold = true))
        root.addView(text(c.body, 16f, Color.parseColor("#C7C2E0")).apply { setPadding(0, dp(10), 0, 0) })
        untilLine()?.let { line ->
            root.addView(TextView(this).apply {
                text = line
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(14), dp(6), dp(14), dp(6))
                background = pill("#33FFFFFF")
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(18) }
            })
        }

        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f).apply { height = dp(40) })

        when (reason) {
            "parent_lock" -> Unit
            "app_blocked" -> root.addView(button("Ask to unblock ${label ?: "it"}", PURPLE, Color.WHITE) { requestAccess() })
            "website_blocked" -> root.addView(button("Ask for access", PURPLE, Color.WHITE) { requestAccess() })
            else -> root.addView(button("Ask for more time", PURPLE, Color.WHITE) { showTimeChoices() })
        }
        root.addView(sosButton())
        root.addView(button("Emergency call", "#00000000", Color.WHITE, outline = true) { emergencyCall() })
        root.addView(button("Go to home screen", "#00000000", Color.parseColor("#C7C2E0")) { goHome() })

        setContentView(scroll)
    }

    private var timeChoicesShown = false

    private fun showTimeChoices() {
        if (timeChoicesShown) return
        timeChoicesShown = true
        val options = listOf(15, 30, 60)
        val sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(12), dp(4), dp(4))
        }
        sheet.addView(text("How much more time?", 16f, Color.WHITE, bold = true).apply { setPadding(0, 0, 0, dp(8)) })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        options.forEach { min ->
            row.addView(button(formatMinutes(min), "#2A1F4A", Color.WHITE) { requestMoreTime(min) }.apply {
                layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(4), 0, dp(4), 0) }
            })
        }
        sheet.addView(row)
        root.addView(sheet, 5.coerceAtMost(root.childCount))
    }

    private fun requestAccess() {
        val key = "last_access_request:${pkg ?: label}"
        if (System.currentTimeMillis() - VoiceKidsPrefs.getLong(this, key) < 10 * 60_000L) {
            Toast.makeText(this, "Already asked. Your parent will see it.", Toast.LENGTH_LONG).show()
            return
        }
        VoiceKidsPrefs.putLong(this, key, System.currentTimeMillis())
        val site = if (reason == "website_blocked") label else null
        io.execute {
            val delivered = ChildRequests.requestAccess(applicationContext, pkg, label, site)
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (delivered) "Sent. Your parent will see your request now."
                    else "You're offline. Your request will be sent when you're back online.",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }

    private fun requestMoreTime(minutes: Int) {
        val lastAt = VoiceKidsPrefs.getLong(this, "last_more_time_request_at")
        if (System.currentTimeMillis() - lastAt < 5 * 60_000L) {
            Toast.makeText(this, "Your request is with your parent. You'll get time as soon as they approve.", Toast.LENGTH_LONG).show()
            return
        }
        VoiceKidsPrefs.putLong(this, "last_more_time_request_at", System.currentTimeMillis())
        val what = when (reason) {
            "app_limit", "app_blocked", "internet_paused" -> label
            "website_blocked" -> label
            else -> null
        }
        io.execute {
            val delivered = ChildRequests.requestMoreTime(applicationContext, minutes, what, reason)
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (delivered) "Sent. Your parent will see your request now."
                    else "You're offline. Your request will be sent when you're back online.",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }

    private fun sosButton(): Button {
        val b = button("Hold for SOS", "#DC2626", Color.WHITE) {}
        var fire: Runnable? = null
        b.setOnClickListener(null)
        b.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    (v as Button).text = "Keep holding…"
                    fire = Runnable {
                        v.text = "Sending SOS…"
                        io.execute {
                            val ok = SosReporter.fire(applicationContext, "Sent from the block screen", null, null)
                            runOnUiThread {
                                v.text = if (ok) "SOS sent" else "SOS will send when online"
                                Toast.makeText(this, if (ok) "Your parent has been alerted." else "No connection. VOICE will keep trying.", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                    handler.postDelayed(fire!!, SOS_HOLD_MS)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    fire?.let { handler.removeCallbacks(it) }
                    if ((v as Button).text == "Keep holding…") v.text = "Hold for SOS"
                    if (event.action == MotionEvent.ACTION_UP) v.performClick()
                }
            }
            true
        }
        return b
    }

    private fun emergencyCall() {
        runCatching {
            startActivity(Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun goHome() {
        runCatching {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }

    /** True while the reason this screen was shown still applies. */
    private fun isStillRestricted(): Boolean {
        val p = pkg
        return when (reason) {
            "parent_lock", "schedule", "restricted_time", "daily_limit" ->
                VoiceKidsPrefs.lockReason(this).isNotEmpty()
            "internet_paused" -> VoiceKidsPrefs.internetPauseActive(this)
            "website_blocked" -> true
            else -> p == null || VoiceKidsPrefs.desiredBlockedPackages(this).contains(p) ||
                VoiceKidsPrefs.desiredBlockAllActive(this)
        }
    }

    private fun nextMidnight(): Long = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, 1)
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    private fun formatMinutes(min: Int): String = when {
        min < 60 -> "$min min"
        min % 60 == 0 -> "${min / 60} h"
        else -> "${min / 60} h ${min % 60} min"
    }

    private fun text(value: String, sizeSp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        gravity = Gravity.CENTER
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setLineSpacing(0f, 1.15f)
    }

    private fun button(label: String, bg: String, fg: Int, outline: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(fg)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        typeface = Typeface.DEFAULT_BOLD
        stateListAnimator = null
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(Color.parseColor(bg))
            if (outline) setStroke(dp(1), Color.parseColor("#55FFFFFF"))
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(10) }
        setOnClickListener { onClick() }
    }

    private fun pill(color: String) = GradientDrawable().apply {
        cornerRadius = dp(999).toFloat()
        setColor(Color.parseColor(color))
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
