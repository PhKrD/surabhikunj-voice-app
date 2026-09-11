package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.security.MessageDigest
import org.json.JSONObject

/**
 * SettingsGuard — keeps the child out of the Settings screens that would
 * turn supervision off.
 *
 * HONEST SCOPE. Android gives no ordinary app a way to *forbid* revoking
 * Accessibility, Device Admin, VPN consent or Usage access; only a Device
 * Owner (factory-reset provisioning) can. What every mainstream parental
 * control on Android does instead — and what this does — is notice the
 * moment those screens come to the foreground and immediately leave them,
 * demanding the parent's PIN to continue. A determined child can still
 * boot to safe mode or use adb. See PLATFORM_LIMITATIONS.md.
 *
 * Detection is deliberately conservative: it fires only when the visible
 * window mentions THIS app *and* one of the dangerous actions, so a child
 * changing the wallpaper or Wi-Fi is never interrupted.
 *
 * Entering the PIN (PinGateActivity) opens a short grace window
 * (VoiceKidsPrefs.settingsGraceUntil) so a parent can actually do the
 * thing they came for.
 */
object SettingsGuard {
    private const val TAG = "VoiceKidsGuard"

    /** Alert the parent at most this often — a child bouncing off the guard shouldn't flood pc_alerts. */
    private const val ALERT_COOLDOWN_MS = 5 * 60_000L

    /** How long a correct PIN stands the guard down for. */
    const val GRACE_MS = 5 * 60_000L

    /** Cap the node walk — some Settings screens have very deep trees and this runs on the a11y callback thread. */
    private const val MAX_NODES = 400

    /**
     * Packages that can host a "turn VOICE off" screen. Matched by prefix
     * so OEM Settings forks (Samsung, Xiaomi, Oppo, ...) are covered
     * without enumerating every build.
     */
    private val GUARDED_PACKAGE_HINTS = listOf(
        "com.android.settings",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.google.android.permissioncontroller",
        "com.samsung.android.lool",
        "com.samsung.accessibility",
        "com.miui.securitycenter",
        "com.miui.packageinstaller",
        "com.coloros.safecenter",
        "com.oplus.safecenter",
        "com.vivo.permissionmanager",
        "com.huawei.systemmanager",
    )

    /**
     * Screens a supervised child has no legitimate reason to be on at all.
     * Matched against the SCREEN TITLE (exact, lower-cased) and the
     * activity class name — not the whole window text, because "Accessibility"
     * is also a row on the Settings home page and matching that would lock
     * the child out of Settings entirely (wi-fi, volume, wallpaper…).
     */
    private val DANGER_TITLES = setOf(
        "accessibility",
        "downloaded apps", "installed services", "installed apps",
        "device admin apps", "device administrators", "device admin",
        "usage access", "usage data access",
        "special app access", "special access",
        "vpn", "vpn settings",
        "display over other apps", "appear on top", "draw over other apps",
    )

    /** Lower-cased fragments of the activity class names for the same screens, for OEM builds whose titles differ. */
    private val DANGER_ACTIVITY_HINTS = listOf(
        "accessibilitysettings", "accessibilitydetails",
        "deviceadminsettings", "deviceadminadd",
        "usageaccesssettings", "usageaccessdetails",
        "vpnsettings",
        "specialaccesssettings",
        "drawoverlaydetails", "manageapplications",
    )

    /**
     * Phrases that make a screen dangerous ONLY in combination with this
     * app being named on it — the app-info page, the uninstall dialog, an
     * individual accessibility-service detail page. Keeping the app-name
     * requirement here is what lets a child still force-stop or uninstall
     * some OTHER app.
     */
    private val DANGER_PHRASES = listOf(
        "device admin", "device administrator", "deactivate",
        "accessibility",
        "usage access", "usage data access",
        "vpn",
        "uninstall", "force stop", "disable", "clear storage", "clear data",
        "display over other apps", "appear on top", "draw over",
        "restricted setting",
    )

    /**
     * Cheap pre-check, so the caller only pays for the (IPC-heavy) window
     * tree on the handful of packages that could host a dangerous screen —
     * this runs on EVERY app switch on the device.
     */
    fun isGuardedPackage(context: Context, pkg: String): Boolean {
        if (!VoiceKidsPrefs.isConfigured(context)) return false
        if (!VoiceKidsPrefs.protectSettings(context)) return false
        // No PIN means no way back through the gate — guarding here would
        // lock the PARENT out of the very screens the setup checklist needs
        // them to visit. The guard switches itself on the moment a PIN is set.
        if (!hasPin(context)) return false
        if (VoiceKidsPrefs.isSettingsGraceActive(context)) return false
        return GUARDED_PACKAGE_HINTS.any { pkg.startsWith(it) }
    }

    /** True when this window is one the child must not reach unsupervised. Call only after isGuardedPackage(). */
    fun shouldBlock(context: Context, event: AccessibilityEvent?, root: AccessibilityNodeInfo?): Boolean {
        val className = event?.className?.toString()?.lowercase().orEmpty()
        if (DANGER_ACTIVITY_HINTS.any { className.contains(it) }) {
            Log.i(TAG, "Guarded screen by activity: $className")
            return true
        }
        // The window title comes through as event.text on
        // TYPE_WINDOW_STATE_CHANGED for essentially every Settings screen.
        val titles = event?.text?.mapNotNull { it?.toString()?.trim()?.lowercase() }.orEmpty()
        titles.firstOrNull { it in DANGER_TITLES }?.let {
            Log.i(TAG, "Guarded screen by title: $it")
            return true
        }

        val root1 = root ?: return false
        val text = collectText(root1)
        val label = appLabel(context).lowercase()
        // Everything below needs our own name on screen, so a child can
        // still force-stop or uninstall some OTHER app, and ordinary
        // Settings pages are never interrupted.
        if (!text.contains(label)) return false
        val hit = DANGER_PHRASES.any { text.contains(it) }
        if (hit) Log.i(TAG, "Guarded screen by app-name + danger phrase")
        return hit
    }

    /**
     * Call immediately BEFORE the app itself sends the user to one of the
     * guarded Settings screens (the setup checklist / permission wizard).
     * Without this the guard would bounce the parent straight back out of
     * the screen the app just asked them to visit.
     */
    fun allowAppInitiatedVisit(context: Context) {
        VoiceKidsPrefs.setSettingsGraceUntil(context, System.currentTimeMillis() + GRACE_MS)
    }

    /**
     * Cover the screen with the PIN gate. Safe to call repeatedly;
     * PinGateActivity is singleTop.
     *
     * Deliberately does NOT kick to home first: PinGateActivity is
     * full-screen and opaque, so the guarded screen is unreachable behind
     * it, and a correct PIN then returns the parent exactly where they
     * were. (An earlier version fired GLOBAL_ACTION_HOME first, which
     * raced the activity launch and killed the gate before it drew.)
     *
     * Falling back to home matters: starting an activity from the
     * background needs the "Display over other apps" grant on Android 10+.
     * Without it the launch is silently blocked, so we bounce the child
     * out instead — the screen is still guarded, just with no explanation.
     */
    fun block(context: Context, service: android.accessibilityservice.AccessibilityService?) {
        Log.w(TAG, "Blocking a protected settings screen")
        if (!launchGate(context)) {
            service?.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
        }
        maybeAlert(context)
    }

    private fun launchGate(context: Context): Boolean {
        if (!DpcActions.canDrawOverlays(context)) return false
        return try {
            context.startActivity(
                Intent(context, PinGateActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not open PIN gate: ${e.message}")
            false
        }
    }

    /** Sends the device to the launcher — used by the gate itself when the child backs out. */
    fun goHome(context: Context) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            Log.w(TAG, "goHome failed: ${e.message}")
        }
    }

    private fun maybeAlert(context: Context) {
        val now = System.currentTimeMillis()
        if (now - VoiceKidsPrefs.lastSettingsBlockAlertAt(context) < ALERT_COOLDOWN_MS) return
        VoiceKidsPrefs.setLastSettingsBlockAlertAt(context, now)

        val childId = VoiceKidsPrefs.childId(context) ?: return
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val row = JSONObject().apply {
            put("child_id", childId)
            put("device_id", deviceId)
            put("alert_type", "tamper_detected")
            put("severity", "warning")
            put("title", "Tried to change VOICE's permissions")
            put("body", "Someone opened a settings screen that can turn supervision off. They were sent back and asked for your PIN.")
            put("metadata", JSONObject().put("kind", "settings_guard"))
        }
        Thread { SupabaseRest.insert(context, "pc_alerts", row) }.start()
    }

    // ── PIN ─────────────────────────────────────────────────────────────
    // Hash format must stay identical to the parent app's
    // src/lib/parentPin.js: sha256("<pin>:<childId>"), lower-case hex. The
    // raw PIN is never stored or transmitted.

    fun hashPin(pin: String, childId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("$pin:$childId".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun hasPin(context: Context): Boolean = VoiceKidsPrefs.parentPinHash(context).isNotEmpty()

    fun verify(context: Context, pin: String): Boolean {
        val stored = VoiceKidsPrefs.parentPinHash(context)
        val childId = VoiceKidsPrefs.childId(context) ?: return false
        if (stored.isEmpty()) return false
        return constantTimeEquals(stored, hashPin(pin, childId))
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun appLabel(context: Context): String = try {
        context.packageManager.getApplicationLabel(context.applicationInfo).toString()
    } catch (e: Exception) {
        "VOICE"
    }

    private fun collectText(root: AccessibilityNodeInfo): String {
        val sb = StringBuilder()
        var visited = 0
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.addLast(root)
        while (stack.isNotEmpty() && visited < MAX_NODES) {
            val node = stack.removeLast()
            visited++
            node.text?.let { sb.append(it).append('\n') }
            node.contentDescription?.let { sb.append(it).append('\n') }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.addLast(it) }
            }
        }
        return sb.toString().lowercase()
    }
}
