package com.surabhikunj.voice.dpc

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * PinGateActivity — "Ask a parent" screen shown when SettingsGuard catches
 * the child on a screen that could disable supervision.
 *
 * A real Activity rather than a system overlay on purpose: it needs
 * keyboard focus for PIN entry, it works whether or not "Display over
 * other apps" was granted, and Android brings it to the front reliably
 * from an accessibility service. Purely a gate — it grants nothing on its
 * own; a correct PIN just opens SettingsGuard.GRACE_MS during which the
 * guard stands down so the parent can finish what they came to do.
 *
 * Built in code (no layout XML) to match BlockOverlay and keep the child
 * surface in one place.
 */
class PinGateActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var input: EditText
    private var attempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#141026"))
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "\uD83D\uDD10"
            textSize = 48f
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "Ask a parent"
            setTextColor(Color.WHITE)
            textSize = 24f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, pad, 0, 0)
        })
        root.addView(TextView(this).apply {
            text = if (SettingsGuard.hasPin(this@PinGateActivity)) {
                "This screen can turn VOICE's protection off. Enter the parent PIN to continue."
            } else {
                "This screen can turn VOICE's protection off. Your parent has been notified."
            }
            setTextColor(Color.parseColor("#B9B3D6"))
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, pad / 2, 0, pad)
        })

        status = TextView(this).apply {
            setTextColor(Color.parseColor("#FF8A8A"))
            textSize = 14f
            gravity = Gravity.CENTER
            visibility = android.view.View.GONE
        }

        if (SettingsGuard.hasPin(this)) {
            input = EditText(this).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                hint = "Parent PIN"
                gravity = Gravity.CENTER
                textSize = 24f
                setTextColor(Color.WHITE)
                setHintTextColor(Color.parseColor("#6E6890"))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
            }
            root.addView(input)
            root.addView(status)
            root.addView(Button(this).apply {
                text = "Unlock settings"
                setPadding(0, pad / 2, 0, pad / 2)
                setOnClickListener { submit() }
            })
        } else {
            root.addView(status)
        }

        root.addView(Button(this).apply {
            text = "Go back"
            setOnClickListener { leave() }
        })

        setContentView(root)
    }

    private fun submit() {
        val pin = input.text?.toString()?.trim().orEmpty()
        if (SettingsGuard.verify(this, pin)) {
            VoiceKidsPrefs.setSettingsGraceUntil(this, System.currentTimeMillis() + SettingsGuard.GRACE_MS)
            finish()
            return
        }
        attempts++
        input.setText("")
        status.visibility = android.view.View.VISIBLE
        status.text = if (attempts >= 3) "Wrong PIN. Ask your parent to unlock this." else "Wrong PIN — try again."
    }

    /**
     * Back must not be a way around the gate. Finishing alone would drop
     * the child straight back onto the guarded Settings screen underneath
     * (and the guard would immediately re-fire, flickering), so leave for
     * the launcher instead.
     */
    private fun leave() {
        SettingsGuard.goHome(this)
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        leave()
    }
}
