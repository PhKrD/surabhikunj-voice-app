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
 * BEST-EFFORT browser-activity monitoring (website visits + search
 * queries) — the same technique real-world consumer parental-control apps
 * use on Android without Device Owner/MDM: reading the browser's own
 * address-bar text via the Accessibility API, keyed off each browser's
 * known view-id for that field (see BROWSER_URL_BAR_IDS below).
 *
 * Explicitly NOT a guarantee of complete coverage:
 *  - Only recognizes the browsers listed below, matched against
 *    `res/values/arrays.xml`'s monitored_browser_packages (which MUST be
 *    kept in sync with the keys of BROWSER_URL_BAR_IDS — the XML list is
 *    what actually filters which events this service even receives).
 *  - A browser UI update can rename its view id and silently break
 *    detection for that browser until this list is updated.
 *  - Incognito/private tabs behave however that specific browser chooses
 *    to expose (or hide) the same address-bar view — not guaranteed
 *    either way, never assume it is/isn't captured.
 *  - Requires the parent to manually enable "VOICE" under
 *    Settings > Accessibility > Installed apps on the CHILD device.
 *    Android does not allow any app to turn this on for itself — same
 *    category of manual, one-time step as Usage Access.
 * See PLATFORM_LIMITATIONS.md before presenting this as exhaustive
 * "we see everything" monitoring anywhere in the UI.
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
        // reporting package). MUST be kept in sync with
        // res/values/arrays.xml's monitored_browser_packages, which is the
        // list that actually determines which apps' events reach this
        // service at all (AndroidManifest -> accessibility_service_config.xml
        // -> android:packageNames).
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
    }

    private data class ParsedBar(val raw: String, val host: String, val searchEngine: String?, val searchQuery: String?)

    private val handler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private var pendingCheck: Runnable? = null
    private val lastLoggedByPackage = HashMap<String, String>()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
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
                val q = uri.getQueryParameter(param)
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
