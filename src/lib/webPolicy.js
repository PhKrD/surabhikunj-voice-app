/**
 * webPolicy.js
 *
 * Pure, unit-tested mirror of android/.../dpc/WebPolicy.kt — the logic
 * that decides what happens to a hostname under the parent's website
 * rules. The Kotlin file is the one that actually runs on the device; this
 * exists so the rules can be tested at all (there is no Kotlin test
 * harness in this repo) and so the parent UI can preview a decision.
 *
 * KEEP THE TWO IN SYNC. The bug this was written after: safe-search host
 * matching used a substring test, so every *.google.com host — mail,
 * drive, play, accounts, photos — was answered with
 * forcesafesearch.google.com's address and simply stopped loading, and
 * ytimg.com (YouTube's image CDN, not a search page) was pointed at
 * restrict.youtube.com, killing every thumbnail. Exact host matching only.
 */

export const VERDICT = Object.freeze({ ALLOW: 'allow', BLOCK: 'block', ALERT: 'alert' })

/** Never blocked, whatever the rules say — blocking these breaks the device or our own supervision. */
export const NEVER_BLOCK_SUFFIXES = Object.freeze([
  'supabase.co',
  'supabase.in',
  'gstatic.com',
  'googleapis.com',
  'google-analytics.com',
  'crashlytics.com',
  'android.com',
  'ntp.org',
])

/**
 * Lower-cases and strips scheme, credentials, port, path, query and any
 * trailing dot. Returns null for anything that isn't a hostname.
 */
export function normalizeHost(raw) {
  if (typeof raw !== 'string') return null
  let h = raw.trim().toLowerCase()
  if (!h) return null
  h = h.split('://').pop()
  h = h.split('/')[0]
  h = h.split('?')[0]
  h = h.split('@').pop()
  h = h.split(':')[0]
  h = h.replace(/\.+$/, '')
  return h && h.includes('.') ? h : null
}

/** True if `host` or any parent domain of it is in `set` — a rule on "x.com" covers "a.b.x.com". */
export function matches(host, set) {
  const domains = set instanceof Set ? set : new Set(set ?? [])
  if (domains.size === 0) return false
  let d = host
  for (;;) {
    if (domains.has(d)) return true
    const dot = d.indexOf('.')
    if (dot < 0) return false
    d = d.slice(dot + 1)
  }
}

/**
 * @param {string} hostRaw
 * @param {{allowed?:Iterable<string>, blocked?:Iterable<string>, alerted?:Iterable<string>,
 *          blockUnknown?:boolean, knownDomains?:Iterable<string>}} rules
 */
export function evaluate(hostRaw, rules = {}) {
  const host = normalizeHost(hostRaw)
  if (!host) return VERDICT.ALLOW
  if (matches(host, NEVER_BLOCK_SUFFIXES)) return VERDICT.ALLOW

  // An explicit allow always wins, and is also the exception list for
  // "block unknown websites".
  if (matches(host, rules.allowed)) return VERDICT.ALLOW
  if (matches(host, rules.blocked)) return VERDICT.BLOCK
  if (rules.blockUnknown && !matches(host, rules.knownDomains)) return VERDICT.BLOCK
  if (matches(host, rules.alerted)) return VERDICT.ALERT
  return VERDICT.ALLOW
}

// ── Safe Search ───────────────────────────────────────────────────────

const GOOGLE_SAFE = 'forcesafesearch.google.com'
const YOUTUBE_SAFE = 'restrictmoderate.youtube.com'

export const EXACT_SAFE_SEARCH_HOSTS = Object.freeze({
  'bing.com': 'strict.bing.com',
  'www.bing.com': 'strict.bing.com',
  'duckduckgo.com': 'safe.duckduckgo.com',
  'www.duckduckgo.com': 'safe.duckduckgo.com',
  'youtube.com': YOUTUBE_SAFE,
  'www.youtube.com': YOUTUBE_SAFE,
  'm.youtube.com': YOUTUBE_SAFE,
  'youtubei.googleapis.com': YOUTUBE_SAFE,
  'youtube.googleapis.com': YOUTUBE_SAFE,
  'www.youtube-nocookie.com': YOUTUBE_SAFE,
})

// google.com, google.co.in, www.google.de — the search front-ends only.
// Anything with another label in front (mail., drive., play., accounts.)
// is a different Google product and must be left completely alone.
const GOOGLE_SEARCH_HOST = /^(www\.)?google(\.[a-z]{2,3}){1,2}$/

/** The safe alias host to answer with instead, or null when `host` isn't a search front-end. */
export function safeSearchAliasFor(host) {
  const h = normalizeHost(host)
  if (!h) return null
  if (EXACT_SAFE_SEARCH_HOSTS[h]) return EXACT_SAFE_SEARCH_HOSTS[h]
  return GOOGLE_SEARCH_HOST.test(h) ? GOOGLE_SAFE : null
}
