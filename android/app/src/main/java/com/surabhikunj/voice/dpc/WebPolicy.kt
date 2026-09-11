package com.surabhikunj.voice.dpc

import android.content.Context

/**
 * WebPolicy — the single place that decides what a hostname resolves to
 * under the parent's website rules.
 *
 * Two completely independent enforcement paths call this, and they MUST
 * agree, so neither may re-derive the decision itself:
 *
 *   1. VoiceKidsAccessibilityService — reads the browser's address bar and
 *      blocks the page. This is the DEFAULT path: it needs no VPN, no VPN
 *      consent, and doesn't touch the device's DNS at all.
 *   2. InternetBlockVpnService's MODE_DNS_FILTER — an OPTIONAL, parent-
 *      enabled local DNS filter (pc_website_filter_settings.use_vpn) that
 *      also covers non-browser apps and browsers we can't read the address
 *      bar of, at the cost of routing all DNS through our tunnel.
 *
 * Domain sets are cached in VoiceKidsPrefs by PolicyEnforcer every pass.
 */
object WebPolicy {

    enum class Verdict { ALLOW, BLOCK, ALERT }

    /**
     * Hosts that must NEVER be blocked, whatever the rules say — blocking
     * them bricks the device or our own supervision:
     *   - our Supabase project + Google Play services endpoints keep the
     *     agent able to receive commands and report state,
     *   - connectivity-check hosts keep Android from declaring the network
     *     dead (which silently disables Wi-Fi on many OEM builds).
     * Mirrors the "protected packages" idea for app blocking.
     */
    private val NEVER_BLOCK_SUFFIXES = setOf(
        "supabase.co",
        "supabase.in",
        "gstatic.com",
        "googleapis.com",
        "google-analytics.com",
        "crashlytics.com",
        "android.com",
        "ntp.org",
    )

    fun evaluate(context: Context, hostRaw: String): Verdict {
        val host = normalizeHost(hostRaw) ?: return Verdict.ALLOW
        if (matches(host, NEVER_BLOCK_SUFFIXES)) return Verdict.ALLOW

        // An explicit allow (individual rule or an allowed category) always
        // wins — it is also the exception list for "block unknown websites".
        if (matches(host, VoiceKidsPrefs.allowedDomains(context))) return Verdict.ALLOW
        if (matches(host, VoiceKidsPrefs.blockedDomains(context))) return Verdict.BLOCK

        if (VoiceKidsPrefs.blockUnknownWebsites(context) &&
            !matches(host, WebCategories.ALL_CATEGORY_DOMAINS)
        ) return Verdict.BLOCK

        if (matches(host, VoiceKidsPrefs.alertDomains(context))) return Verdict.ALERT
        return Verdict.ALLOW
    }

    /**
     * Lower-cases, strips a trailing dot, a port, and any leading "www."
     * is deliberately KEPT — matches() walks parent domains anyway, so
     * "www.x.com" still matches a rule on "x.com".
     */
    fun normalizeHost(raw: String): String? {
        var h = raw.trim().lowercase()
        if (h.isEmpty()) return null
        h = h.substringBefore('/')
        h = h.substringBefore('?')
        h = h.substringAfter("://")
        h = h.substringAfterLast('@')
        h = h.substringBefore(':')
        h = h.trimEnd('.')
        return h.takeIf { it.isNotEmpty() && it.contains('.') }
    }

    /** True if `host` or any of its parent domains is in `set` — a rule on "x.com" covers "a.b.x.com". */
    fun matches(host: String, set: Set<String>): Boolean {
        if (set.isEmpty()) return false
        var d = host
        while (true) {
            if (set.contains(d)) return true
            val dot = d.indexOf('.')
            if (dot < 0) return false
            d = d.substring(dot + 1)
        }
    }

    // ── Safe Search ──────────────────────────────────────────────────────
    // DNS-based Safe Search / YouTube Restricted Mode, exactly as Google,
    // Microsoft and DuckDuckGo document it for router-level filters: point
    // the SEARCH hostname at a special alias host.
    //
    // CRITICAL: this must only ever match the actual search front-ends. An
    // earlier implementation used a substring test, so every *.google.com
    // host (mail, drive, play, accounts, photos, ...) was answered with
    // forcesafesearch.google.com's IP and simply stopped loading, and
    // ytimg.com — YouTube's image CDN, not a search host at all — was
    // pointed at restrict.youtube.com, breaking every thumbnail. Exact
    // host matching only.

    private const val GOOGLE_SAFE = "forcesafesearch.google.com"
    private const val YOUTUBE_SAFE = "restrictmoderate.youtube.com"

    private val EXACT_SAFE_SEARCH_HOSTS: Map<String, String> = mapOf(
        "bing.com" to "strict.bing.com",
        "www.bing.com" to "strict.bing.com",
        "duckduckgo.com" to "safe.duckduckgo.com",
        "www.duckduckgo.com" to "safe.duckduckgo.com",
        "youtube.com" to YOUTUBE_SAFE,
        "www.youtube.com" to YOUTUBE_SAFE,
        "m.youtube.com" to YOUTUBE_SAFE,
        "youtubei.googleapis.com" to YOUTUBE_SAFE,
        "youtube.googleapis.com" to YOUTUBE_SAFE,
        "www.youtube-nocookie.com" to YOUTUBE_SAFE,
    )

    /**
     * Google runs a country-code front-end per market (google.co.in,
     * google.de, ...). Only the bare host and its "www." form are search
     * pages; anything with another label in front (mail., drive., play.,
     * accounts., ...) is a different product and must be left alone.
     */
    private val GOOGLE_SEARCH_HOST = Regex("^(www\\.)?google(\\.[a-z]{2,3}){1,2}$")

    /** The safe alias host to resolve and answer with instead, or null when `host` isn't a search front-end. */
    fun safeSearchAliasFor(host: String): String? {
        EXACT_SAFE_SEARCH_HOSTS[host]?.let { return it }
        return if (GOOGLE_SEARCH_HOST.matches(host)) GOOGLE_SAFE else null
    }
}
