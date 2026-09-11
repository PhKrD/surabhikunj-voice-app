package com.surabhikunj.voice.dpc

/**
 * WebCategories
 *
 * Native counterpart of src/lib/webCategories.js — SAME category keys,
 * kept in sync manually. Each category maps to a curated SEED LIST of
 * well-known domains (and their subdomains, via DnsFilterEngine.isBlocked's
 * parent-domain walk), NOT a real-time content classifier. See
 * PLATFORM_LIMITATIONS.md "Website filtering categories" before treating
 * a blocked category as catching every site of that kind on the internet.
 *
 * Also holds the browser-package catalog used by the optional "Block
 * unsupported browsers" setting: VoiceKidsAccessibilityService can only
 * read the address bar (for web-activity logging) of browsers in its own
 * BROWSER_URL_BAR_IDS map. When that setting is on, any OTHER installed
 * browser app is treated as a blocked app entirely (kicked to home),
 * closing the "install a browser we don't recognize" loophole.
 */
object WebCategories {

    val CATEGORY_DOMAINS: Map<String, Set<String>> = mapOf(
        "educational" to setOf(
            "khanacademy.org", "coursera.org", "wikipedia.org", "byjus.com",
            "nptel.ac.in", "duolingo.com", "brainly.com",
        ),
        "government" to setOf(
            "gov.in", "india.gov.in", "usa.gov", "gov.uk",
        ),
        "entertainment" to setOf(
            "netflix.com", "primevideo.com", "hotstar.com", "disneyplus.com",
            "spotify.com", "twitch.tv",
        ),
        // Deliberately the search HOSTS, not the apexes. A rule on
        // "google.com" is parent-domain-matched, so blocking this category
        // would also take out Gmail, Drive, Play, Photos and every Google
        // sign-in — which is not what "block search engines" means to a
        // parent. Bare "google.com" typed without a subdomain is the one
        // gap; that's a far better trade than bricking the phone.
        "search_engines" to setOf(
            "www.google.com", "www.bing.com", "duckduckgo.com",
            "search.yahoo.com", "www.ecosia.org", "yandex.com", "search.brave.com",
        ),
        "news" to setOf(
            "ndtv.com", "bbc.com", "cnn.com", "timesofindia.indiatimes.com", "reuters.com",
        ),
        "sports" to setOf(
            "espn.com", "cricbuzz.com", "espncricinfo.com", "nba.com",
        ),
        "business" to setOf(
            "linkedin.com", "bloomberg.com", "moneycontrol.com", "economictimes.indiatimes.com",
        ),
        "social_media" to setOf(
            "facebook.com", "instagram.com", "twitter.com", "x.com", "snapchat.com",
            "tiktok.com", "reddit.com", "discord.com",
        ),
        "gambling" to setOf(
            "bet365.com", "pokerstars.com", "draftkings.com", "1xbet.com",
        ),
        "proxies_loopholes" to setOf(
            "hidemyass.com", "proxysite.com", "kproxy.com", "croxyproxy.com", "vpnbook.com",
        ),
        "violence" to setOf(
            "gorevideos.com", "bestgore.com",
        ),
        "weapons" to setOf(
            "gunbroker.com", "budsgunshop.com",
        ),
        "profanity" to setOf(
            "urbandictionary.com",
        ),
        "mature_content" to setOf(
            "reddit.com/r/nsfw",
        ),
        "pornography" to setOf(
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com",
        ),
        "alcohol" to setOf(
            "totalwine.com", "drizly.com",
        ),
        "drugs" to setOf(
            "leafly.com", "weedmaps.com",
        ),
        "tobacco" to setOf(
            "vaporfi.com", "cigarsinternational.com",
        ),
    )

    /** All browser package names VoiceKidsAccessibilityService knows how to read the address bar of. */
    val SUPPORTED_BROWSER_PACKAGES: Set<String> = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev",
        "com.sec.android.app.sbrowser", "com.microsoft.emmx", "org.mozilla.firefox",
        "com.opera.browser", "com.brave.browser", "com.mi.globalbrowser",
        "com.duckduckgo.mobile.android",
    )

    /**
     * Other common Android browser apps a child might install specifically
     * to dodge address-bar monitoring / DNS filtering (e.g. one with a
     * built-in VPN or its own DoH resolver). Seed list, not exhaustive.
     */
    val OTHER_KNOWN_BROWSER_PACKAGES: Set<String> = setOf(
        "com.UCMobile.intl", "com.ucmobile.lite", "com.kiwibrowser.browser",
        "com.opera.mini.native", "com.opera.gx", "org.torproject.torbrowser",
        "acr.browser.lightning", "mark.via.gp", "com.yandex.browser",
        "com.vivaldi.browser", "com.qihoo.contacts",
    )

    fun categoryDomains(keys: Collection<String>): Set<String> {
        val out = mutableSetOf<String>()
        for (key in keys) CATEGORY_DOMAINS[key]?.let { out.addAll(it) }
        return out
    }

    /**
     * Every domain in every seed list — the "is this site known at all?"
     * set behind the opt-in "block unknown websites" setting. Deliberately
     * unioned with ESSENTIAL_DOMAINS: the seed lists above are a curated
     * few dozen sites, so a literal default-deny against them alone would
     * take out app stores, CDNs, OS services and the child's school
     * portal along with everything else. The parent-facing toggle warns
     * about this too (WebsiteRulesTab).
     */
    val ALL_CATEGORY_DOMAINS: Set<String> by lazy {
        CATEGORY_DOMAINS.values.flatten().toSet() + ESSENTIAL_DOMAINS
    }

    /**
     * Infrastructure a phone stops working without: OS/update/CDN hosts,
     * app stores, and the certificate/time services everything else
     * depends on. Never counted as an "unknown website".
     */
    private val ESSENTIAL_DOMAINS: Set<String> = setOf(
        "google.com", "gstatic.com", "googleapis.com", "googleusercontent.com",
        "ggpht.com", "ytimg.com", "youtube.com", "android.com", "googlevideo.com",
        "apple.com", "icloud.com", "microsoft.com", "windowsupdate.com",
        "cloudflare.com", "cloudfront.net", "akamaized.net", "akamai.net",
        "fastly.net", "jsdelivr.net", "digicert.com", "letsencrypt.org",
        "ntp.org", "whatsapp.net", "whatsapp.com", "supabase.co",
    )
}
