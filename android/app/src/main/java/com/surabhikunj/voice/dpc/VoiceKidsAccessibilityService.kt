package com.surabhikunj.voice.dpc

import android.accessibilityservice.AccessibilityService
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * VoiceKidsAccessibilityService
 *
 * Does two independent jobs, both keyed off the same TYPE_WINDOW_STATE_CHANGED
 * events (this service now watches ALL apps, not just browsers — see
 * accessibility_service_config.xml, which no longer restricts packageNames):
 *
 * 1. APP BLOCKING / SCHEDULES (see enforceForegroundApp below) — the
 *    PRIMARY app-block mechanism for the default, no-factory-reset
 *    enforcement model (Device Admin, not Device Owner). PolicyEnforcer.kt
 *    writes the desired blocked/allow-list/block-all state into
 *    VoiceKidsPrefs every pass; this service reads it and, the moment a
 *    disallowed app comes to the foreground, calls
 *    performGlobalAction(GLOBAL_ACTION_HOME) and shows a brief block
 *    overlay (BlockOverlay.kt) if the overlay permission is granted.
 *    This is a best-effort deterrent, not a hard OS-level lock — a
 *    technically determined child could disable Accessibility for this
 *    app in Settings. See PLATFORM_LIMITATIONS.md. (On a device that
 *    additionally happens to be Device Owner, PolicyEnforcer ALSO applies
 *    a real setPackagesSuspended()/lock-task, which this soft mechanism
 *    then backs up rather than replaces.)
 *
 * 2. BEST-EFFORT browser-activity monitoring (website visits + search
 *    queries) — reading the browser's own address-bar text, keyed off
 *    each browser's known view-id (see BROWSER_URL_BAR_IDS below). Same
 *    caveats as before: only recognizes listed browsers, a browser UI
 *    update can silently break detection, incognito behavior is
 *    browser-dependent, and it requires the parent to manually enable
 *    "VOICE" under Settings > Accessibility on the CHILD device — same
 *    category of manual step as Usage Access. See PLATFORM_LIMITATIONS.md
 *    before presenting either of these as exhaustive/unbypassable.
 */
class VoiceKidsAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "VoiceKidsA11y"

        // Address bars fire many transient text-changed events while the
        // user is typing or a page is redirecting. Wait for things to
        // settle before reading the "final" value, instead of logging
        // every keystroke.
        private const val DEBOUNCE_MS = 700L

        // package -> candidate address-bar view-id local names (without the
        // "<package>:id/" prefix, which is built per-event from the actual
        // reporting package). This is the ONLY gate on which packages get
        // their address bar read (accessibility_service_config.xml no
        // longer restricts packageNames, since enforceForegroundApp() below
        // needs window-state events from every app, not just browsers).
        private val BROWSER_URL_BAR_IDS: Map<String, List<String>> = mapOf(
            "com.android.chrome" to listOf("url_bar"),
            "com.chrome.beta" to listOf("url_bar"),
            "com.chrome.dev" to listOf("url_bar"),
            "com.sec.android.app.sbrowser" to listOf("location_bar_edit_text"),
            "com.microsoft.emmx" to listOf("url_bar"),
            "org.mozilla.firefox" to listOf("mozac_browser_toolbar_url_view", "mozac_browser_toolbar_edit_url_view"),
            "com.opera.browser" to listOf("url_field"),
            "com.brave.browser" to listOf("url_bar"),
            "com.mi.globalbrowser" to listOf("address_bar_edit_text"),
            "com.duckduckgo.mobile.android" to listOf("omnibarTextInput"),
        )

        // (host substring, query-param name, human label)
        private val SEARCH_ENGINES: List<Triple<String, String, String>> = listOf(
            Triple("google.", "q", "Google"),
            Triple("bing.com", "q", "Bing"),
            Triple("duckduckgo.com", "q", "DuckDuckGo"),
            Triple("search.yahoo.com", "p", "Yahoo"),
        )

        // Never kick these to home regardless of policy — mirrors
        // PolicyEnforcer.kt's PROTECTED_PACKAGES / pc_is_protected_package().
        // Must include our own package and the launcher, or a block_all
        // schedule would lock the child out of the one screen that can fix it.
        private val NEVER_BLOCK = setOf(
            "com.surabhikunj.voice",
            "com.android.systemui",
            "com.android.settings",
            "com.android.providers.settings",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.android.server.telecom",
            "com.android.phone",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.android.emergency",
            "com.android.incallui",
            "android",
        )

        // Avoid re-triggering the kick-to-home/overlay every single time a
        // WINDOW_STATE_CHANGED fires for the same still-foreground blocked
        // app (multiple events can fire per app open).
        private const val REBLOCK_COOLDOWN_MS = 1500L

        // "Alert me when used" fires at most once per app per half hour;
        // blocked-attempt telemetry at most once per app per 10 minutes.
        private const val APP_OPENED_ALERT_COOLDOWN_MS = 30 * 60_000L
        private const val BLOCKED_ATTEMPT_ALERT_COOLDOWN_MS = 10 * 60_000L
    }

    private data class ParsedBar(val raw: String, val host: String, val searchEngine: String?, val searchQuery: String?)

    private val handler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private var pendingCheck: Runnable? = null
    private val lastLoggedByPackage = HashMap<String, String>()
    private var lastBlockedPkg: String? = null
    private var lastBlockedAt = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            enforceForegroundApp(pkg)
        }

        if (!BROWSER_URL_BAR_IDS.containsKey(pkg)) return
        // Not enrolled/configured as a supervised device -> do nothing,
        // even if the toggle was somehow left on (e.g. after unenrolling).
        if (!VoiceKidsPrefs.isConfigured(applicationContext)) return

        pendingCheck?.let { handler.removeCallbacks(it) }
        val check = Runnable { checkAddressBar(pkg) }
        pendingCheck = check
        handler.postDelayed(check, DEBOUNCE_MS)
    }

    override fun onInterrupt() {
        // Nothing to tear down — no persistent resources held between events.
    }

    /**
     * Primary app-block enforcement for the default (Device Admin only, no
     * factory reset) model. See PolicyEnforcer.kt for what writes the
     * desired* state this reads, and DpcActions.kt's doc comment for the
     * full enforcement model / why this exists alongside the optional
     * Device Owner path.
     */
    private fun enforceForegroundApp(pkg: String) {
        if (pkg == applicationContext.packageName) return
        if (NEVER_BLOCK.contains(pkg)) return
        if (!VoiceKidsPrefs.isConfigured(applicationContext)) return

        val blockAllActive = VoiceKidsPrefs.desiredBlockAllActive(applicationContext)
        val allowList = VoiceKidsPrefs.desiredAllowListPackages(applicationContext)
        val blockedSet = VoiceKidsPrefs.desiredBlockedPackages(applicationContext)

        val isBlocked = when {
            blockAllActive -> true
            allowList != null -> !allowList.contains(pkg)
            else -> blockedSet.contains(pkg)
        }
        if (!isBlocked) {
            maybeAlertAppOpened(pkg)
            return
        }

        val now = System.currentTimeMillis()
        if (pkg == lastBlockedPkg && now - lastBlockedAt < REBLOCK_COOLDOWN_MS) return
        lastBlockedPkg = pkg
        lastBlockedAt = now

        // Pick the child-facing explanation: a whole-device lock (daily
        // limit / restricted time / schedule) reads differently from "this
        // one app is blocked".
        val reason = if (blockAllActive || allowList != null) {
            VoiceKidsPrefs.lockReason(applicationContext).ifEmpty { "schedule" }
        } else "app_blocked"
        Log.i(TAG, "Blocking foreground app: $pkg (reason=$reason)")
        performGlobalAction(GLOBAL_ACTION_HOME)
        BlockOverlay.show(applicationContext, reason, appLabel(pkg))
        maybeAlertBlockedAttempt(pkg, reason)
    }

    /** pc_app_rules.alert_on_use — "tell me when this app is used" (Qustodio-style), rate-limited per app. */
    private fun maybeAlertAppOpened(pkg: String) {
        if (!VoiceKidsPrefs.alertOnUsePackages(applicationContext).contains(pkg)) return
        val now = System.currentTimeMillis()
        if (now - VoiceKidsPrefs.lastAppOpenedAlertAt(applicationContext, pkg) < APP_OPENED_ALERT_COOLDOWN_MS) return
        VoiceKidsPrefs.setLastAppOpenedAlertAt(applicationContext, pkg, now)
        val label = appLabel(pkg)
        ioExecutor.execute {
            insertAlert("app_opened", "info", "$label opened", "$label is being used right now.", JSONObject().put("package_name", pkg))
        }
    }

    /** Blocked-attempt telemetry for the parent's activity timeline, rate-limited per app so a persistent child can't flood pc_alerts. */
    private fun maybeAlertBlockedAttempt(pkg: String, reason: String) {
        val now = System.currentTimeMillis()
        if (now - VoiceKidsPrefs.lastAppOpenedAlertAt(applicationContext, "blocked:$pkg") < BLOCKED_ATTEMPT_ALERT_COOLDOWN_MS) return
        VoiceKidsPrefs.setLastAppOpenedAlertAt(applicationContext, "blocked:$pkg", now)
        val label = appLabel(pkg)
        val why = when (reason) {
            "daily_limit" -> "daily screen-time limit reached"
            "restricted_time" -> "restricted time"
            "schedule" -> "a scheduled break is active"
            else -> "the app is blocked"
        }
        ioExecutor.execute {
            insertAlert("blocked_app_attempt", "info", "Tried to open $label", "Blocked because $why.", JSONObject().put("package_name", pkg).put("reason", reason))
        }
    }

    private fun appLabel(pkg: String): String = try {
        val pm = applicationContext.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
        pkg
    }

    private fun insertAlert(type: String, severity: String, title: String, body: String, metadata: JSONObject) {
        val deviceId = VoiceKidsPrefs.deviceId(applicationContext) ?: return
        val childId = VoiceKidsPrefs.childId(applicationContext) ?: return
        val row = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("alert_type", type)
            put("severity", severity)
            put("title", title)
            put("body", body)
            put("metadata", metadata)
        }
        if (!SupabaseRest.insert(applicationContext, "pc_alerts", row)) Log.w(TAG, "Failed to insert $type alert")
    }

    private fun checkAddressBar(pkg: String) {
        val root = rootInActiveWindow ?: return
        val idNames = BROWSER_URL_BAR_IDS[pkg] ?: return

        var text: String? = null
        for (idName in idNames) {
            val nodes = try {
                root.findAccessibilityNodeInfosByViewId("$pkg:id/$idName")
            } catch (e: Exception) {
                null
            }
            val match = nodes?.firstOrNull { !it.text.isNullOrBlank() }
            if (match != null) {
                text = match.text?.toString()
                break
            }
        }
        if (text.isNullOrBlank()) return

        val parsed = normalizeAddressBarText(text) ?: return
        if (lastLoggedByPackage[pkg] == parsed.raw) return
        lastLoggedByPackage[pkg] = parsed.raw

        ioExecutor.execute { report(pkg, parsed) }
    }

    /**
     * Best-effort normalization: browsers commonly hide the scheme/"www."
     * in the displayed address, and while the user is still typing, the
     * field may contain plain search terms rather than a URL at all — that
     * case is intentionally dropped here rather than mis-logged as a
     * "domain visited". We'll catch the real destination once navigation
     * completes and the bar settles to the resulting URL.
     */
    private fun normalizeAddressBarText(raw: String): ParsedBar? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val looksLikeInProgressQuery = trimmed.contains(" ") && !trimmed.contains("://")
        if (looksLikeInProgressQuery) return null

        val withScheme = if (trimmed.contains("://")) trimmed else "https://$trimmed"
        val uri = try { Uri.parse(withScheme) } catch (e: Exception) { null } ?: return null
        val host = uri.host?.takeIf { it.isNotBlank() } ?: return null

        for ((hostMatch, param, label) in SEARCH_ENGINES) {
            if (host.contains(hostMatch)) {
                // Uri.getQueryParameter() only does RFC-3986 percent-decoding —
                // it deliberately does NOT turn "+" into a space, because that's
                // an HTML form-encoding convention, not part of URI decoding.
                // Search engines encode spaces as "+" in query strings, so
                // without this the query would show up as "hare+krishna".
                val q = uri.getQueryParameter(param)?.replace('+', ' ')
                if (!q.isNullOrBlank()) {
                    return ParsedBar(raw = trimmed, host = host, searchEngine = label, searchQuery = q)
                }
            }
        }
        return ParsedBar(raw = trimmed, host = host, searchEngine = null, searchQuery = null)
    }

    private fun report(browserPackage: String, parsed: ParsedBar) {
        val deviceId = VoiceKidsPrefs.deviceId(applicationContext) ?: return
        val childId = VoiceKidsPrefs.childId(applicationContext) ?: return

        val row = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("browser_package", browserPackage)
            put("occurred_at", isoNow())
            if (parsed.searchQuery != null) {
                put("activity_type", "search")
                put("search_engine", parsed.searchEngine)
                put("search_query", parsed.searchQuery)
                put("domain", parsed.host)
            } else {
                put("activity_type", "visit")
                put("domain", parsed.host)
            }
        }

        val ok = SupabaseRest.insert(applicationContext, "pc_web_activity", row)
        if (!ok) Log.w(TAG, "Failed to report web activity for $browserPackage")
    }

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())
}
