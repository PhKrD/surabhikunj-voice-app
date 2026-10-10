package com.surabhikunj.voice.dpc

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * PolicyEnforcer — the authoritative on-device policy engine. Native port of
 * src/lib/policy.js (schedules + per-app rules) and
 * src/lib/screenTimePolicy.js (daily time limits + restricted times).
 *
 * WHY THIS EXISTS: enforcement used to live only in the WebView's JS timers,
 * which Android suspends the moment the child leaves the app. This runs on
 * VoiceKidsMonitorService's own cadence (POLICY_ENFORCE_INTERVAL_MS) so
 * bedtime, "time's up", a parent deleting a rule, etc. take effect within
 * seconds regardless of what the WebView is doing.
 *
 * ENFORCEMENT MODEL (no factory reset): every decision here is written into
 * VoiceKidsPrefs as a "desired state" that VoiceKidsAccessibilityService
 * enforces by kicking disallowed foreground apps back to home. Device Admin
 * additionally gives lockNow() (whole-screen lock) and VPN consent gives
 * internet pause. Device Owner (optional Advanced mode) adds a harder
 * OS-level suspend on top — never required. See DpcActions.kt.
 *
 * Keep this in sync with policy.js / screenTimePolicy.js — same protected
 * packages, same schedule-severity order, same lock-priority order
 * (bonus > schedule > restricted time > daily limit), same
 * "allow overrides block" rule.
 */
object PolicyEnforcer {
    private const val TAG = "VoiceKidsPolicy"

    // Mirrors PROTECTED_PACKAGES in src/lib/policy.js / protectedPackages.js
    // and pc_is_protected_package() in supabase/61_policy_integrity.sql +
    // 66_fix_protected_package_name.sql. The agent's OWN package must be
    // here — suspending it would make the device permanently unmanageable.
    private val PROTECTED_PACKAGES = setOf(
        "com.android.server.telecom",
        "com.android.phone",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.android.emergency",
        "com.android.incallui",
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.providers.settings",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.surabhikunj.voice",
    )

    // Mirrors SCREEN_TIME_EXCLUDED_PACKAGES in src/lib/screenTimePolicy.js.
    private val SCREEN_TIME_EXCLUDED = setOf(
        "android",
        "com.android.systemui",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.surabhikunj.voice",
    )

    /**
     * What is locking the whole device right now, if anything.
     *   key     — stable identity used to detect the TRANSITION into a lock
     *             (hard lockNow() fires once, not every pass)
     *   reason  — "schedule" | "restricted_time" | "daily_limit" (mirrors
     *             screenTimePolicy.js LOCK_REASON_COPY keys); "" for an
     *             internet-only restriction that does not lock apps
     *   action  — block_all | allow_list_only | block_internet |
     *             lock_navigation | lock_device | alert_only
     */
    private data class LockDecision(
        val key: String,
        val reason: String,
        val action: String,
        val label: String,
        val schedule: JSONObject? = null,
    ) {
        val blocksApps: Boolean get() = action in setOf("block_all", "allow_list_only", "lock_navigation", "lock_device")
        val pausesInternet: Boolean get() = action in setOf("block_all", "block_internet", "lock_navigation", "lock_device")
        val wantsHardLock: Boolean get() = action == "lock_device" || (action == "block_all" && schedule?.optJSONArray("always_allowed_packages")?.let { it.length() == 0 } ?: true)
    }

    /**
     * All server-side policy inputs for one child, fetched together.
     * `schedules`/`rules` are mandatory (a failed fetch aborts the pass);
     * everything else tolerates null so a transient failure on one table —
     * or pc_restricted_times not existing yet before migration 70 — never
     * stops app-rule/schedule enforcement.
     */
    private class PolicyInputs(
        val childId: String,
        val policyVersion: Long?,
        val schedules: JSONArray,
        val rules: JSONArray,
        val screenTimeRule: JSONObject?,
        val restricted: JSONObject?,
        val websiteRules: JSONArray?,
        val categoryRules: JSONArray?,
        val filterSettings: JSONObject?,
        val fetchedAt: Long,
    )

    @Volatile private var cachedInputs: PolicyInputs? = null

    // Every enforceable table bumps pc_children.policy_version via trigger
    // (61_policy_integrity.sql + 70_qustodio_parity.sql), so one cheap GET
    // per pass tells us whether the other seven fetches are needed at all.
    // The age cap heals anything a missed bump could otherwise hide forever.
    private const val INPUT_CACHE_MAX_AGE_MS = 5 * 60_000L

    // How often the child row (desired lock / pause / extra time + policy
    // version) is re-read. Local evaluation still runs every tick; only the
    // network read is spaced out. Screen on: a parent's "Lock now" lands in
    // seconds. Screen off: nobody is using the phone, so a slower read saves
    // battery and data — and the screen turning on forces a read at once.
    private const val CHILD_ROW_INTERVAL_ACTIVE_MS = 8_000L
    private const val CHILD_ROW_INTERVAL_IDLE_MS = 60_000L

    @Volatile private var lastChildRowAt = 0L
    @Volatile var lastOnlineAt = 0L
        private set
    @Volatile var lastEvaluationAt = 0L
        private set
    @Volatile var policySource = "none"
        private set

    private fun isInteractive(context: Context): Boolean =
        runCatching { context.getSystemService(android.os.PowerManager::class.java)?.isInteractive ?: true }.getOrDefault(true)

    /**
     * Returns the policy to enforce this pass. Never returns "no policy"
     * just because the network failed: the last policy fetched successfully
     * is kept in memory AND on disk (survives reboot / process death), so a
     * phone with no signal keeps enforcing — and keeps running time-based
     * transitions like bedtime starting or extra time running out. Before
     * this, a failed fetch skipped the whole pass, so an offline phone never
     * entered bedtime and a phone that went offline DURING bedtime stayed
     * locked past its end.
     */
    private fun loadInputs(context: Context, childId: String, force: Boolean): PolicyInputs? {
        val now = System.currentTimeMillis()
        val cached = cachedInputs?.takeIf { it.childId == childId }
            ?: restoreInputs(context, childId)?.also { cachedInputs = it }
        val interval = if (isInteractive(context)) CHILD_ROW_INTERVAL_ACTIVE_MS else CHILD_ROW_INTERVAL_IDLE_MS
        if (!force && cached != null && now - lastChildRowAt < interval) {
            return cached
        }
        lastChildRowAt = now

        // select=* rather than naming columns: parent_pin_hash /
        // protect_settings only exist after migration 71, and PostgREST
        // rejects the whole request for an unknown column, which would
        // take enforcement down entirely on a not-yet-migrated database.
        val childRows = fetchRows(context, "pc_children", "id=eq.$childId&select=*")
        if (childRows == null) {
            policySource = if (cached != null) "cached" else "none"
            return cached
        }
        val childRow = childRows.optJSONObject(0)
        if (childRow == null) {
            // Online, but the child row is invisible: the parent removed this
            // device (or the child). Confirm against our own device row before
            // releasing anything — never on a guess.
            if (isDeviceRevoked(context)) releaseRevokedDevice(context)
            return null
        }
        lastOnlineAt = now
        VoiceKidsPrefs.setParentPinHash(context, childRow.optString("parent_pin_hash", "").takeIf { it.isNotEmpty() && it != "null" })
        VoiceKidsPrefs.setProtectSettings(context, childRow.optBoolean("protect_settings", true))
        applyDesiredState(context, childRow)

        val policyVersion = childRow.optLong("policy_version", -1L).takeIf { it >= 0 }
        if (!force && cached != null && policyVersion != null && cached.policyVersion == policyVersion &&
            now - cached.fetchedAt < INPUT_CACHE_MAX_AGE_MS) {
            policySource = "live"
            return cached
        }

        val schedules = fetchRows(context, "pc_schedules", "child_id=eq.$childId&select=*")
        val rules = fetchRows(context, "pc_app_rules", "child_id=eq.$childId&select=*")
        if (schedules == null || rules == null) {
            policySource = if (cached != null) "cached" else "none"
            return cached
        }
        val inputs = PolicyInputs(
            childId = childId,
            policyVersion = policyVersion,
            schedules = schedules,
            rules = rules,
            screenTimeRule = fetchRows(context, "pc_screen_time_rules", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            restricted = fetchRows(context, "pc_restricted_times", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            websiteRules = fetchRows(context, "pc_website_rules", "child_id=eq.$childId&is_enabled=eq.true&select=domain,action"),
            categoryRules = fetchRows(context, "pc_website_category_rules", "child_id=eq.$childId&select=category_key,action"),
            filterSettings = fetchRows(context, "pc_website_filter_settings", "child_id=eq.$childId&select=*")?.optJSONObject(0),
            fetchedAt = now,
        )
        cachedInputs = inputs
        persistInputs(context, inputs)
        policySource = "live"
        return inputs
    }

    private fun persistInputs(context: Context, inputs: PolicyInputs) {
        val json = JSONObject()
            .put("child_id", inputs.childId)
            .put("policy_version", inputs.policyVersion ?: JSONObject.NULL)
            .put("schedules", inputs.schedules)
            .put("rules", inputs.rules)
            .put("screen_time_rule", inputs.screenTimeRule ?: JSONObject.NULL)
            .put("restricted", inputs.restricted ?: JSONObject.NULL)
            .put("website_rules", inputs.websiteRules ?: JSONObject.NULL)
            .put("category_rules", inputs.categoryRules ?: JSONObject.NULL)
            .put("filter_settings", inputs.filterSettings ?: JSONObject.NULL)
            .put("fetched_at", inputs.fetchedAt)
        VoiceKidsPrefs.setPolicyInputsJson(context, json.toString())
    }

    private fun restoreInputs(context: Context, childId: String): PolicyInputs? {
        val raw = VoiceKidsPrefs.policyInputsJson(context) ?: return null
        return try {
            val j = JSONObject(raw)
            if (j.optString("child_id") != childId) return null
            PolicyInputs(
                childId = childId,
                policyVersion = if (j.isNull("policy_version")) null else j.optLong("policy_version"),
                schedules = j.optJSONArray("schedules") ?: JSONArray(),
                rules = j.optJSONArray("rules") ?: JSONArray(),
                screenTimeRule = j.optJSONObject("screen_time_rule"),
                restricted = j.optJSONObject("restricted"),
                websiteRules = j.optJSONArray("website_rules"),
                categoryRules = j.optJSONArray("category_rules"),
                filterSettings = j.optJSONObject("filter_settings"),
                // Restored copies are always re-validated at the next online read.
                fetchedAt = 0L,
            ).also { policySource = "cached" }
        } catch (e: Exception) {
            Log.w(TAG, "Stored policy unreadable, ignoring: ${e.message}")
            null
        }
    }

    private fun isDeviceRevoked(context: Context): Boolean {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return false
        val rows = fetchRows(context, "pc_devices", "id=eq.$deviceId&select=id,is_active") ?: return false
        val row = rows.optJSONObject(0) ?: return true
        return !row.optBoolean("is_active", true)
    }

    /**
     * The parent removed this phone. Lift every restriction we applied so the
     * child is not left locked by a supervision that no longer exists, and
     * stop enforcing until the phone is paired again.
     */
    private fun releaseRevokedDevice(context: Context) {
        Log.w(TAG, "Device removed by parent — releasing all restrictions")
        VoiceKidsPrefs.setDesiredBlockedPackages(context, emptySet())
        VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
        VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
        VoiceKidsPrefs.setInternetPauseActive(context, false)
        VoiceKidsPrefs.setManualInternetPause(context, false)
        VoiceKidsPrefs.setParentLockActive(context, false)
        VoiceKidsPrefs.setLockReason(context, "")
        VoiceKidsPrefs.setAppliedLockKey(context, "")
        VoiceKidsPrefs.setBlockedDomains(context, emptySet())
        VoiceKidsPrefs.setPolicyInputsJson(context, null)
        VoiceKidsPrefs.putString(context, "revoked", "1")
        if (DpcActions.isDeviceOwner(context)) {
            val suspended = VoiceKidsPrefs.appliedSuspended(context).toList()
            if (suspended.isNotEmpty()) DpcActions.setPackagesSuspended(context, suspended, false)
            DpcActions.setAllowedPackages(context, emptyList())
        }
        DpcActions.resumeInternet(context)
        cachedInputs = null
    }

    fun isRevoked(context: Context): Boolean = VoiceKidsPrefs.getString(context, "revoked") == "1"

    /** Next pass re-reads the child row (screen on, network back) but keeps the policy cache. */
    fun invalidateChildRow() {
        lastChildRowAt = 0L
    }

    /** Drops the input cache so the next pass re-reads everything (sync_rules command, reassignment). */
    fun invalidateCache() {
        cachedInputs = null
        lastChildRowAt = 0L
    }

    /**
     * Reconciles the parent's DESIRED enforcement state (migration 72:
     * pc_children.parent_lock_active / internet_pause_active /
     * bonus_expires_at) into local prefs.
     *
     * This is what makes "Lock now" / "Unlock" / "Pause internet" /
     * "Resume internet" / extra time independent of whether the device was
     * online when the parent tapped the button. Those controls used to be
     * carried ONLY by a pc_device_commands row: if the device was offline,
     * asleep, force-stopped or its token had expired when the command was
     * written, nothing ever applied it and — because the resulting bit lived
     * only in SharedPreferences — nothing could reconcile it afterwards
     * either. A device could sit locked forever while the parent tapped
     * "Unlock" to no effect.
     *
     * Deliberately runs BEFORE the policy_version cache check in
     * loadInputs(), so it converges on every single pass (~4s) even when no
     * policy table changed. Columns are read defensively: on a database
     * where migration 72 has not been applied the keys are simply absent,
     * and we must then leave the command-driven local values alone rather
     * than reading a missing column as "false" and releasing a real lock.
     */
    private fun applyDesiredState(context: Context, childRow: JSONObject) {
        if (childRow.has("parent_lock_active") && !childRow.isNull("parent_lock_active")) {
            val wanted = childRow.optBoolean("parent_lock_active", false)
            if (wanted != VoiceKidsPrefs.parentLockActive(context)) {
                Log.i(TAG, "Desired state: parent lock -> $wanted")
                VoiceKidsPrefs.setParentLockActive(context, wanted)
            }
        }
        if (childRow.has("internet_pause_active") && !childRow.isNull("internet_pause_active")) {
            val wanted = childRow.optBoolean("internet_pause_active", false)
            if (wanted != VoiceKidsPrefs.manualInternetPause(context)) {
                Log.i(TAG, "Desired state: internet pause -> $wanted")
                VoiceKidsPrefs.setManualInternetPause(context, wanted)
                // Tear the tunnel down immediately on release; enforce()
                // below brings it up when the pause is switched on.
                if (!wanted) DpcActions.resumeInternet(context)
            }
        }
        if (childRow.has("bonus_expires_at")) {
            val raw = childRow.optString("bonus_expires_at", "").takeIf { it.isNotEmpty() && it != "null" }
            // 0L is this pref's "no bonus" sentinel, matching VoiceKidsPrefs.
            val wanted = raw?.let { parseIsoToEpochMillis(it) } ?: 0L
            if (wanted != VoiceKidsPrefs.bonusExpiresAt(context)) {
                Log.i(TAG, "Desired state: bonus expiry -> $wanted")
                VoiceKidsPrefs.setBonusExpiresAt(context, wanted)
            }
        }
    }

    /**
     * Parses a Supabase/Postgres ISO timestamp to epoch millis, or null if
     * it is in none of the shapes PostgREST emits. Mirrors the helper of the
     * same name in VoiceKidsMonitorService (which is private to it).
     */
    private fun parseIsoToEpochMillis(iso: String): Long? {
        for (pattern in listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )) {
            try {
                val sdf = SimpleDateFormat(pattern, Locale.US)
                if (pattern.endsWith("'Z'")) sdf.timeZone = TimeZone.getTimeZone("UTC")
                return sdf.parse(iso)?.time
            } catch (_: Exception) {
                // try the next shape
            }
        }
        Log.w(TAG, "Could not parse timestamp: $iso")
        return null
    }

    /** One enforcement pass at a time — called from VoiceKidsMonitorService's single executor thread already. */
    @Synchronized
    fun enforce(context: Context, force: Boolean = false) {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return
        if (isRevoked(context)) return

        val inputs = loadInputs(context, childId, force)
        if (inputs == null) {
            // Nothing fetched yet and nothing stored: there is no policy to
            // apply. Leave whatever is in force alone — a failed fetch must
            // never be read as "no rules" and release a block.
            Log.w(TAG, "enforce: no policy available yet, skipping pass")
            return
        }
        lastEvaluationAt = System.currentTimeMillis()
        val schedules = inputs.schedules
        val rules = inputs.rules
        val screenTimeRule = inputs.screenTimeRule
        val restricted = inputs.restricted
        val policyVersion = inputs.policyVersion
        val websiteRules = inputs.websiteRules
        val categoryRules = inputs.categoryRules
        val filterSettings = inputs.filterSettings

        val bonusActive = VoiceKidsPrefs.isBonusActive(context)
        val now = Calendar.getInstance()
        val dow = now.get(Calendar.DAY_OF_WEEK) - 1 // Calendar.SUNDAY=1 -> JS getDay()=0

        val activeSchedule = findActiveSchedule(schedules, now, bonusActive)
        val usageAvailable = UsageStatsHelper.hasUsageAccess(context)
        val usageByPackage: Map<String, Long> = if (usageAvailable) {
            UsageStatsHelper.todayUsageCached(context)
        } else emptyMap()

        // ── Daily screen time (mirrors screenTimePolicy.js) ─────────────
        val usedMin = (totalScreenTimeMs(context, usageByPackage) / 60_000L).toInt()
        val limitMin = limitForDay(screenTimeRule, dow)
        VoiceKidsPrefs.setScreenTimeSnapshot(context, if (usageAvailable) usedMin else -1, limitMin)
        val limitReached = limitMin != null && usageAvailable && !bonusActive && usedMin >= limitMin
        val today = isoDate(System.currentTimeMillis())
        if (limitMin != null && usageAvailable && !bonusActive &&
            screenTimeRule?.optString("limit_action") != "alert_only") {
            ChildNotifier.maybeWarn(context, "daily", "screen time", usedMin, limitMin, today)
        }

        // ── App rules ───────────────────────────────────────────────────
        val (blockListBase, allowList, alertOnUse) = resolveAppRules(context, rules, usageByPackage, usageAvailable, bonusActive, dow, today)
        VoiceKidsPrefs.setAlertOnUsePackages(context, alertOnUse)

        // ── Web filtering settings ──────────────────────────────────────
        val applyFilters = filterSettings?.optBoolean("apply_filters", true) ?: true
        val blockUnsupportedBrowsers = applyFilters && (filterSettings?.optBoolean("block_unsupported_browsers", false) ?: false)
        val blockUnknownWebsites = applyFilters && (filterSettings?.optBoolean("block_unknown_websites", false) ?: false)
        val enforceSafeSearch = applyFilters && (filterSettings?.optBoolean("enforce_safe_search", false) ?: false)
        val alertOnBlock = filterSettings?.optBoolean("alert_on_block", true) ?: true
        // Opt-in, default off — website blocking works through the
        // accessibility URL read (WebPolicy) without any tunnel.
        val useVpn = applyFilters && (filterSettings?.optBoolean("use_vpn", false) ?: false)
        VoiceKidsPrefs.setUseVpnFiltering(context, useVpn)

        // "Block unsupported browsers": kick to home any known browser app
        // that isn't one VoiceKidsAccessibilityService can actually read
        // the address bar of / DNS filtering can't be bypassed via — see
        // WebCategories.kt's doc comment.
        val blockList = if (blockUnsupportedBrowsers) blockListBase + WebCategories.OTHER_KNOWN_BROWSER_PACKAGES else blockListBase

        val categories = resolveCategoryDomains(categoryRules)
        val ruleDomains = resolveWebsiteRuleDomains(websiteRules)
        val blockedDomains = ruleDomains?.let { it.blocked + (if (applyFilters) categories.blocked else emptySet()) }
        val allowedDomains = (ruleDomains?.allowed ?: emptySet()) + (if (applyFilters) categories.allowed else emptySet())
        val alertDomains = (ruleDomains?.alerted ?: emptySet()) + (if (applyFilters) categories.alerted else emptySet())
        VoiceKidsPrefs.setAllowedDomains(context, allowedDomains)
        VoiceKidsPrefs.setAlertDomains(context, alertDomains)
        VoiceKidsPrefs.setBlockUnknownWebsites(context, blockUnknownWebsites)
        VoiceKidsPrefs.setEnforceSafeSearch(context, enforceSafeSearch)
        VoiceKidsPrefs.setAlertOnWebsiteBlock(context, alertOnBlock)

        // ── Whole-device lock resolution (mirrors resolveLockState) ─────
        // Priority: parent's explicit "Lock now" > extra time > active
        // routine > restricted-time cell > daily limit. "Lock now" is the
        // parent's most deliberate, most recent instruction, so extra time
        // granted earlier must not cancel it (it used to). Extra time already
        // zeroed activeSchedule/limitReached.
        val restrictedActive = !bonusActive && isRestrictedNow(restricted, now)
        val parentLock = VoiceKidsPrefs.parentLockActive(context)
        val lock: LockDecision? = when {
            parentLock -> LockDecision("parent_lock", "parent_lock", "lock_device", "Locked by parent")
            activeSchedule != null -> {
                val action = activeSchedule.optString("action")
                LockDecision(
                    key = "schedule:${activeSchedule.optString("id")}",
                    reason = if (action == "block_internet") "" else "schedule",
                    action = action,
                    label = activeSchedule.optString("name"),
                    schedule = activeSchedule,
                )
            }
            restrictedActive -> {
                val action = restricted!!.optString("action").takeIf { it in setOf("lock_navigation", "lock_device", "block_internet") } ?: "lock_navigation"
                LockDecision("restricted_time", if (action == "block_internet") "" else "restricted_time", action, "Restricted time")
            }
            limitReached -> {
                val action = screenTimeRule!!.optString("limit_action").takeIf { it in setOf("lock_navigation", "lock_device", "alert_only") } ?: "lock_navigation"
                LockDecision("daily_limit", if (action == "alert_only") "" else "daily_limit", action, "Daily limit")
            }
            else -> null
        }
        VoiceKidsPrefs.setLockUntil(context, lockEndsAt(lock, restricted, now))

        // Parent-facing alerts for the two limit events (once per day / per
        // window), independent of whether the lock action is alert_only.
        if (limitReached && (screenTimeRule?.optBoolean("alert_on_limit", true) ?: true)) {
            if (VoiceKidsPrefs.lastLimitAlertDate(context) != today) {
                VoiceKidsPrefs.setLastLimitAlertDate(context, today)
                Outbox.alert(context, "screen_time_exceeded", "warning",
                    "Daily screen-time limit reached",
                    "$usedMin minutes used of today's $limitMin minute limit.",
                    JSONObject().put("total_minutes", usedMin).put("limit_minutes", limitMin))
            }
        }

        val manualPause = VoiceKidsPrefs.manualInternetPause(context)
        val signature = "v=$policyVersion|lock=${lock?.key}:${lock?.action}|pause=$manualPause|" +
            "${blockList.sorted()}|${allowList.sorted()}|${alertOnUse.sorted()}|${blockedDomains?.sorted()}|" +
            "$blockUnknownWebsites|$enforceSafeSearch|${allowedDomains.sorted()}|${alertDomains.sorted()}"
        val appliedLockKey = VoiceKidsPrefs.appliedLockKey(context)

        val deviceAdmin = DpcActions.isDeviceAdmin(context)
        val deviceOwner = DpcActions.isDeviceOwner(context)
        val vpnConsent = DpcActions.hasVpnConsent(context)
        // The pause itself no longer depends on VPN consent: the
        // accessibility service keeps every internet-using app off screen
        // (VoiceKidsPrefs.internetPauseActive). The tunnel, when consented,
        // is an extra layer that also stops background traffic.
        val previousInternetPause = VoiceKidsPrefs.internetPauseActive(context)
        val internetPauseWanted = lock?.pausesInternet == true || manualPause
        VoiceKidsPrefs.setInternetPauseActive(context, internetPauseWanted)
        if (previousInternetPause && !internetPauseWanted) DpcActions.resumeInternet(context)
        val vpnPauseActive = internetPauseWanted && vpnConsent
        // Accessibility-based soft blocking (VoiceKidsAccessibilityService)
        // needs no Device Admin/Owner at all — it's a separate OS permission.
        // Device Admin is only needed here for lockDevice()/pauseInternet().
        // We always write the desired block/allow state below regardless of
        // deviceAdmin, so a device with only Accessibility enabled (no admin
        // yet) still gets real app-blocking — just not lockNow()/VPN pause.

        var ok = true
        val lockTransition = (lock?.key ?: "") != appliedLockKey

        // ── Whole-device lock enforcement ───────────────────────────────
        // Soft-lock state (desired*) is always written for
        // VoiceKidsAccessibilityService to enforce, regardless of Device
        // Admin/Owner status. Device Owner additionally gets the harder
        // OS-level lock-task calls as a bonus (see DpcActions.kt).
        if (lock != null) {
            val allowed = jsonStringArray(lock.schedule?.optJSONArray("always_allowed_packages"))
            when {
                lock.action == "allow_list_only" || (lock.action == "block_all" && allowed.isNotEmpty()) -> {
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, allowed.toSet())
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                    if (deviceOwner) ok = DpcActions.setAllowedPackages(context, allowed)
                }
                lock.blocksApps -> {
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, true)
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                }
                else -> {
                    VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
                    VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
                }
            }
            if (lock.pausesInternet) {
                // Internet pause is best-effort: without the one-time VPN
                // consent the app-level lock still stands, so a missing
                // consent is reported (vpn_consent=false) rather than
                // treated as an enforcement failure.
                if (vpnConsent) ok = DpcActions.pauseInternet(context) && ok
            }
            // Hard screen lock ONLY on the transition into this lock — not on
            // every 4-second pass, which would keep switching the screen off
            // for the whole window and hide the "ask for more time" screen.
            if (lockTransition && lock.wantsHardLock && deviceAdmin) DpcActions.lockDevice(context)
            VoiceKidsPrefs.setLockReason(context, lock.reason)
            VoiceKidsPrefs.setLockLabel(context, lock.label)
            VoiceKidsPrefs.setAppliedLockKey(context, lock.key)
            VoiceKidsPrefs.setAppliedScheduleLock(context, true)
        } else if (appliedLockKey.isNotEmpty() || VoiceKidsPrefs.appliedScheduleLock(context)) {
            VoiceKidsPrefs.setDesiredAllowListPackages(context, null)
            VoiceKidsPrefs.setDesiredBlockAllActive(context, false)
            VoiceKidsPrefs.setLockReason(context, "")
            VoiceKidsPrefs.setLockLabel(context, "")
            if (deviceAdmin) DpcActions.unlockDevice(context)
            // A parent's explicit "Pause internet" outlives any schedule/limit
            // window — only tear the tunnel down when nothing else wants it.
            if (!manualPause) DpcActions.resumeInternet(context)
            VoiceKidsPrefs.setAppliedLockKey(context, "")
            VoiceKidsPrefs.setAppliedScheduleLock(context, false)
        }

        // Manual "Pause internet" is kept in force across passes (cheap no-op
        // when the tunnel is already up in block-all mode) so nothing below
        // can accidentally swap the tunnel back to DNS-filter mode.
        if (manualPause && vpnConsent && lock?.pausesInternet != true) ok = DpcActions.pauseInternet(context) && ok

        // ── Per-app reconciliation ──────────────────────────────────────
        // Primary mechanism: write the desired set for
        // VoiceKidsAccessibilityService to enforce (works under Device
        // Admin only, no reset needed). Device Owner additionally gets a
        // real setPackagesSuspended() call as a stronger bonus layer.
        val desiredSet = blockList.filterNot { isProtectedPackage(it) || EssentialApps.isEssential(context, it) }.toSet()
        VoiceKidsPrefs.setDesiredBlockedPackages(context, desiredSet)

        var suspendOk = true
        if (deviceOwner) {
            val appliedSuspended = VoiceKidsPrefs.appliedSuspended(context)
            val toSuspend = (desiredSet - appliedSuspended).toList()
            val toUnsuspend = (appliedSuspended - desiredSet).filterNot { isProtectedPackage(it) }
            if (toSuspend.isNotEmpty()) suspendOk = DpcActions.setPackagesSuspended(context, toSuspend, true) != null
            if (toUnsuspend.isNotEmpty()) suspendOk = suspendOk && DpcActions.setPackagesSuspended(context, toUnsuspend, false) != null
            if (suspendOk) VoiceKidsPrefs.setAppliedSuspended(context, desiredSet)
        }

        val settled = suspendOk && ok
        if (settled) {
            VoiceKidsPrefs.setAppliedSignature(context, signature)
        } else {
            VoiceKidsPrefs.setAppliedSignature(context, null) // force retry next tick
        }

        // ── Website filtering (pc_website_rules enforcement) ────────────
        // See DpcActions.startWebsiteFilter/InternetBlockVpnService's
        // MODE_DNS_FILTER for the actual mechanism. Skipped entirely when
        // the websiteRules fetch itself failed (null) — same
        // fail-safe-by-not-changing-anything rule as schedules/app rules.
        var websiteFilterActive = VoiceKidsPrefs.websiteFilterActive(context)
        if (blockedDomains != null) {
            VoiceKidsPrefs.setBlockedDomains(context, blockedDomains)
            // A lock (or the parent's manual pause) that pauses internet
            // already owns the VPN tunnel via pauseInternet() above
            // (MODE_BLOCK_ALL) — domain filtering would be moot underneath a
            // full internet pause, and only one VPN mode can hold the tunnel
            // at a time anyway.
            val lockOwnsVpn = vpnPauseActive
            val desiredWebsiteFilter = useVpn &&
                (blockedDomains.isNotEmpty() || blockUnknownWebsites || enforceSafeSearch || alertDomains.isNotEmpty()) &&
                !lockOwnsVpn && vpnConsent
            if (desiredWebsiteFilter) {
                if (DpcActions.startWebsiteFilter(context)) {
                    websiteFilterActive = true
                    VoiceKidsPrefs.setWebsiteFilterActive(context, true)
                }
            } else if (desiredWebsiteFilter != websiteFilterActive) {
                if (lockOwnsVpn) {
                    // pauseInternet() (MODE_BLOCK_ALL) took the tunnel THIS
                    // pass — never call stopWebsiteFilter() here, it would
                    // tear that back down. Just record we no longer drive it.
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                } else if (DpcActions.stopWebsiteFilter(context)) {
                    websiteFilterActive = false
                    VoiceKidsPrefs.setWebsiteFilterActive(context, false)
                }
            }
        }

        reportEnforcementState(context, deviceId, policyVersion, mapOf(
            "policy_source" to policySource,
            "lock_until" to VoiceKidsPrefs.lockUntil(context).takeIf { it > 0 }?.let { isoTimestamp(it) },
            "battery_optimization_exempt" to DpcActions.isIgnoringBatteryOptimizations(context),
            "notifications_allowed" to notificationsAllowed(context),
            "location_permission" to locationPermission(context),
            "native_session_independent" to VoiceKidsPrefs.hasIndependentSession(context),
            "queued_reports" to Outbox.pendingCount(context),
            "app_version" to appVersion(context),
            // Lets the parent's device-health view show the right
            // manufacturer-specific battery/autostart steps.
            "manufacturer" to android.os.Build.MANUFACTURER,
            "model" to android.os.Build.MODEL,
            "android_version" to android.os.Build.VERSION.RELEASE,
            "device_admin" to deviceAdmin,
            "device_owner" to deviceOwner,
            "accessibility_enabled" to AccessibilityStatus.isEnabled(context),
            "overlay_granted" to DpcActions.canDrawOverlays(context),
            "vpn_consent" to vpnConsent,
            "vpn_filtering_wanted" to useVpn,
            "usage_access" to usageAvailable,
            "active_schedule" to (activeSchedule?.optString("name")),
            "lock_reason" to (lock?.reason?.takeIf { it.isNotEmpty() }),
            "lock_action" to lock?.action,
            "internet_paused" to internetPauseWanted,
            "manual_internet_pause" to manualPause,
            "screen_time_today_min" to (if (usageAvailable) usedMin else null),
            "screen_time_limit_min" to limitMin,
            "desired_blocked_count" to desiredSet.size,
            "website_filter_active" to websiteFilterActive,
            "last_error" to if (settled) null else "partial_apply_failure",
        ))
    }

    // ── Time rules: see PolicyRules.kt (pure, JVM unit-tested) ──────────

    private fun parseHm(value: String?): Int? = PolicyRules.parseHm(value)
    private fun findActiveSchedule(schedules: JSONArray, now: Calendar, bonusActive: Boolean): JSONObject? =
        PolicyRules.findActiveSchedule(schedules, now, bonusActive)
    fun limitForDay(rule: JSONObject?, dow: Int): Int? = PolicyRules.limitForDay(rule, dow)
    private fun appLimitForDay(rule: JSONObject, dow: Int): Int? = PolicyRules.appLimitForDay(rule, dow)
    fun isRestrictedNow(restricted: JSONObject?, now: Calendar): Boolean = PolicyRules.isRestrictedNow(restricted, now)

    /**
     * Foreground ms across all apps except launchers, system UI, keyboards
     * and VOICE itself. Uses the device's real launcher list, not just
     * Pixel's, so time spent on a Samsung/Xiaomi home screen isn't counted.
     */
    fun totalScreenTimeMs(context: Context, usageByPackage: Map<String, Long>): Long {
        val notScreenTime = EssentialApps.launchersAndKeyboards(context)
        return usageByPackage.entries.filter {
            it.value > 0 && it.key !in SCREEN_TIME_EXCLUDED && it.key !in notScreenTime
        }.sumOf { it.value }
    }

    /**
     * When the current whole-device restriction ends, for the block screen's
     * "Until 6:00 AM". 0 = open-ended or unknown (a parent's lock, a pause).
     */
    private fun lockEndsAt(lock: LockDecision?, restricted: JSONObject?, now: Calendar): Long {
        if (lock == null) return 0L
        return when (lock.reason.ifEmpty { lock.key.substringBefore(":") }) {
            "schedule" -> lock.schedule?.let { PolicyRules.scheduleEndsAt(it, now) } ?: 0L
            "restricted_time" -> PolicyRules.restrictedEndsAt(restricted, now)
            "daily_limit" -> PolicyRules.nextLocalMidnight(now)
            else -> 0L
        }
    }

    // ── App-rule resolution (mirrors resolvePolicy) ─────────────────────

    private data class AppRuleResolution(val blockList: List<String>, val allowList: List<String>, val alertOnUse: Set<String>)

    private fun resolveAppRules(
        context: Context,
        rules: JSONArray,
        usageByPackage: Map<String, Long>,
        usageAvailable: Boolean,
        bonusActive: Boolean,
        dow: Int,
        today: String,
    ): AppRuleResolution {
        val blockSet = mutableSetOf<String>()
        val allowSet = mutableSetOf<String>()
        val alertSet = mutableSetOf<String>()
        val limitStatus = JSONObject()

        for (i in 0 until rules.length()) {
            val rule = rules.getJSONObject(i)
            if (!rule.optBoolean("is_enabled", true)) continue
            val pkg = rule.optString("package_name").takeIf { it.isNotEmpty() } ?: continue
            if (rule.optBoolean("alert_on_use", false) && !isProtectedPackage(pkg)) alertSet.add(pkg)
            when (rule.optString("action")) {
                "allow" -> allowSet.add(pkg)
                else -> if (!isProtectedPackage(pkg)) {
                    when (rule.optString("action")) {
                        "block" -> blockSet.add(pkg)
                        "time_limit" -> {
                            val limitMin = appLimitForDay(rule, dow)
                            if (limitMin != null && usageAvailable && !bonusActive) {
                                val usedMin = ((usageByPackage[pkg] ?: 0L) / 60_000).toInt()
                                if (usedMin >= limitMin) {
                                    blockSet.add(pkg)
                                    limitStatus.put(pkg, "$usedMin/$limitMin")
                                } else {
                                    ChildNotifier.maybeWarn(context, pkg, rule.optString("app_name").ifEmpty { pkg }, usedMin, limitMin, today)
                                }
                            }
                        }
                    }
                }
            }
        }
        for (pkg in allowSet) blockSet.remove(pkg)
        VoiceKidsPrefs.setAppLimitStatus(context, limitStatus.toString())
        return AppRuleResolution(blockSet.toList(), allowSet.toList(), alertSet)
    }

    private fun isProtectedPackage(pkg: String): Boolean = PROTECTED_PACKAGES.contains(pkg)

    // ── Website-rule resolution ──────────────────────────────────────────

    private data class DomainSets(val blocked: Set<String>, val allowed: Set<String>, val alerted: Set<String>)

    /**
     * Splits enabled pc_website_rules rows into blocked / allowed / alert
     * domain sets. Returns null (not empty) when the fetch itself failed, so
     * the caller can distinguish "no rules" from "couldn't check" and avoid
     * flipping filtering off on a network blip.
     */
    private fun resolveWebsiteRuleDomains(websiteRules: JSONArray?): DomainSets? {
        if (websiteRules == null) return null
        val blocked = mutableSetOf<String>()
        val allowed = mutableSetOf<String>()
        val alerted = mutableSetOf<String>()
        for (i in 0 until websiteRules.length()) {
            val rule = websiteRules.getJSONObject(i)
            val domain = rule.optString("domain").trim().lowercase().takeIf { it.isNotEmpty() } ?: continue
            when (rule.optString("action")) {
                "block" -> blocked.add(domain)
                "allow" -> allowed.add(domain)
                "alert" -> alerted.add(domain)
            }
        }
        return DomainSets(blocked, allowed, alerted)
    }

    /**
     * Resolves per-category allow/block/alert into concrete domain sets via
     * WebCategories.CATEGORY_DOMAINS. A category with no explicit row
     * uses its own default (see src/lib/webCategories.js defaultAction) —
     * matters because most categories default to 'allow' and only a
     * handful (gambling, violence, pornography, ...) default to 'block'.
     */
    private fun resolveCategoryDomains(categoryRules: JSONArray?): DomainSets {
        val explicit = mutableMapOf<String, String>() // category_key -> action
        if (categoryRules != null) {
            for (i in 0 until categoryRules.length()) {
                val row = categoryRules.getJSONObject(i)
                val key = row.optString("category_key").takeIf { it.isNotEmpty() } ?: continue
                explicit[key] = row.optString("action")
            }
        }
        val blocked = mutableSetOf<String>()
        val allowed = mutableSetOf<String>()
        val alerted = mutableSetOf<String>()
        for ((key, domains) in WebCategories.CATEGORY_DOMAINS) {
            when (explicit[key] ?: DEFAULT_CATEGORY_ACTION[key] ?: "allow") {
                "block" -> blocked.addAll(domains)
                "alert" -> alerted.addAll(domains)
                else -> allowed.addAll(domains)
            }
        }
        return DomainSets(blocked, allowed, alerted)
    }

    // Mirrors src/lib/webCategories.js's per-category defaultAction — kept
    // in sync manually (only the categories that default to 'block' need
    // listing; everything else defaults to 'allow').
    private val DEFAULT_CATEGORY_ACTION = mapOf(
        "gambling" to "block",
        "proxies_loopholes" to "block",
        "violence" to "block",
        "weapons" to "block",
        "profanity" to "block",
        "mature_content" to "block",
        "pornography" to "block",
        "alcohol" to "block",
        "drugs" to "block",
        "tobacco" to "block",
    )

    // ── I/O helpers ──────────────────────────────────────────────────────

    private fun fetchRows(context: Context, table: String, query: String): JSONArray? =
        SupabaseRest.get(context, table, query)

    private fun jsonStringArray(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it, null) }
    }

    // The report used to be PATCHed on every 4-second pass — ~21,000 writes a
    // day per phone, mostly identical. Now it is sent when anything in it
    // changes, and otherwise refreshed every few minutes so the parent can
    // tell a quiet phone from a dead one.
    private const val REPORT_REFRESH_MS = 3 * 60_000L
    @Volatile private var lastReportSignature: String? = null
    @Volatile private var lastReportAt = 0L

    private fun notificationsAllowed(context: Context): Boolean =
        runCatching { androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled() }.getOrDefault(true)

    private fun locationPermission(context: Context): String {
        val pm = android.content.pm.PackageManager.PERMISSION_GRANTED
        val fine = context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == pm
        val coarse = context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == pm
        val background = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == pm
        return when {
            (fine || coarse) && background -> "always"
            fine || coarse -> "while_in_use"
            else -> "denied"
        }
    }

    private fun appVersion(context: Context): String =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "" }.getOrDefault("")

    private fun reportEnforcementState(context: Context, deviceId: String, policyVersion: Long?, state: Map<String, Any?>) {
        val json = JSONObject()
        for ((k, v) in state) {
            when (v) {
                null -> json.put(k, JSONObject.NULL)
                else -> json.put(k, v)
            }
        }
        val signature = "$policyVersion|$json"
        val now = System.currentTimeMillis()
        if (signature == lastReportSignature && now - lastReportAt < REPORT_REFRESH_MS) return
        json.put("reported_at", isoTimestamp(now))
        val body = JSONObject()
            .put("enforcement_state", json)
            .put("last_enforcement_at", isoTimestamp(System.currentTimeMillis()))
            .put("platform", "android")
        // Confirms to the parent which pc_children.policy_version this device
        // has actually applied — drives the "Policy version X of Y applied" /
        // syncing indicator (src/lib/policySync.js). Only written when we
        // could read the version; a failed read leaves the last value alone.
        if (policyVersion != null) body.put("applied_policy_version", policyVersion)
        // last_seen_at rides along: a successful report IS proof of life.
        body.put("last_seen_at", isoTimestamp(now))
        if (SupabaseRest.patch(context, "pc_devices", "id=eq.$deviceId", body)) {
            lastReportSignature = signature
            lastReportAt = now
        }
    }

    /** Forces the next pass to re-send the report (after a command, on reconnect). */
    fun markReportStale() {
        lastReportSignature = null
    }

    private fun isoTimestamp(epochMillis: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(epochMillis))
    }

    /** Device-local calendar date — the child's "today" for once-a-day alerts. */
    private fun isoDate(epochMillis: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(epochMillis))
}
