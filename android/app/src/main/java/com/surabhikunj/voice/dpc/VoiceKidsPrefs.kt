package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.SharedPreferences

/**
 * VoiceKidsPrefs
 *
 * Persists the pieces of the device's Supabase session that the native
 * background service needs, so it can keep reporting location/usage even
 * when the WebView/JS runtime is suspended or the app is fully backgrounded.
 *
 * The JS layer pushes fresh values here right after enrollment and whenever
 * its own Supabase session refreshes (see src/lib/locationPlugin.js).
 */
object VoiceKidsPrefs {
    private const val PREFS_NAME = "voice_kids_session"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun saveSession(
        context: Context,
        supabaseUrl: String,
        anonKey: String,
        deviceId: String,
        childId: String,
        orgId: String,
        accessToken: String,
        refreshToken: String,
    ) {
        prefs(context).edit()
            .putString("supabase_url", supabaseUrl)
            .putString("anon_key", anonKey)
            .putString("device_id", deviceId)
            .putString("child_id", childId)
            .putString("org_id", orgId)
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .apply()
    }

    fun updateTokens(context: Context, accessToken: String, refreshToken: String) {
        prefs(context).edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    fun isConfigured(context: Context): Boolean =
        !prefs(context).getString("device_id", null).isNullOrEmpty() &&
            !prefs(context).getString("access_token", null).isNullOrEmpty()

    fun supabaseUrl(context: Context): String? = prefs(context).getString("supabase_url", null)
    fun anonKey(context: Context): String? = prefs(context).getString("anon_key", null)
    fun deviceId(context: Context): String? = prefs(context).getString("device_id", null)
    fun childId(context: Context): String? = prefs(context).getString("child_id", null)
    fun orgId(context: Context): String? = prefs(context).getString("org_id", null)
    fun accessToken(context: Context): String? = prefs(context).getString("access_token", null)
    fun refreshToken(context: Context): String? = prefs(context).getString("refresh_token", null)

    // ── Policy enforcement state (mirrors enforcementStore.js) ──────────
    // Persisted so the native enforcer (PolicyEnforcer) and the JS engine
    // (ruleEngine.js, via commandPoller.js's grant/revoke_bonus_time handling)
    // agree on what's currently applied, regardless of which layer is alive.

    /** Comma-separated package names currently suspended by the native/JS enforcer. */
    fun appliedSuspended(context: Context): Set<String> =
        prefs(context).getStringSet("applied_suspended", emptySet()) ?: emptySet()

    fun setAppliedSuspended(context: Context, packages: Set<String>) {
        prefs(context).edit().putStringSet("applied_suspended", packages).apply()
    }

    fun appliedScheduleLock(context: Context): Boolean =
        prefs(context).getBoolean("applied_schedule_lock", false)

    fun setAppliedScheduleLock(context: Context, locked: Boolean) {
        prefs(context).edit().putBoolean("applied_schedule_lock", locked).apply()
    }

    fun appliedSignature(context: Context): String? = prefs(context).getString("applied_signature", null)

    fun setAppliedSignature(context: Context, signature: String?) {
        prefs(context).edit().putString("applied_signature", signature).apply()
    }

    /** Parent-granted bonus time expiry (epoch millis), shared with the JS layer's localStorage flag. */
    fun bonusExpiresAt(context: Context): Long = prefs(context).getLong("bonus_expires_at", 0L)

    fun setBonusExpiresAt(context: Context, epochMillis: Long?) {
        prefs(context).edit().putLong("bonus_expires_at", epochMillis ?: 0L).apply()
    }

    fun isBonusActive(context: Context): Boolean = bonusExpiresAt(context) > System.currentTimeMillis()

    // ── Desired enforcement state for Accessibility-based soft blocking ──
    // Written by PolicyEnforcer every pass, read by VoiceKidsAccessibilityService
    // on every TYPE_WINDOW_STATE_CHANGED event. This is the primary app-block
    // mechanism for devices that are Device Admin only (the default, no-reset
    // path) — see DpcActions.kt's doc comment for the full enforcement model.

    /** Packages that should be kicked to home the moment they come to the foreground. */
    fun desiredBlockedPackages(context: Context): Set<String> =
        prefs(context).getStringSet("desired_blocked_packages", emptySet()) ?: emptySet()

    fun setDesiredBlockedPackages(context: Context, packages: Set<String>) {
        prefs(context).edit().putStringSet("desired_blocked_packages", packages).apply()
    }

    /**
     * Non-null while an allow_list_only (or block_all with a non-empty
     * always-allowed list) schedule is active: only these packages may be
     * in the foreground, everything else gets kicked home. Null = no
     * allow-list restriction currently active.
     */
    fun desiredAllowListPackages(context: Context): Set<String>? =
        if (prefs(context).getBoolean("desired_allow_list_active", false))
            prefs(context).getStringSet("desired_allow_list_packages", emptySet()) ?: emptySet()
        else null

    fun setDesiredAllowListPackages(context: Context, packages: Set<String>?) {
        prefs(context).edit()
            .putBoolean("desired_allow_list_active", packages != null)
            .putStringSet("desired_allow_list_packages", packages ?: emptySet())
            .apply()
    }

    /** True while a block_all schedule with NO always-allowed apps is active (hard lock attempt + soft-lock fallback). */
    fun desiredBlockAllActive(context: Context): Boolean =
        prefs(context).getBoolean("desired_block_all_active", false)

    fun setDesiredBlockAllActive(context: Context, active: Boolean) {
        prefs(context).edit().putBoolean("desired_block_all_active", active).apply()
    }

    // ── Tamper-detection state (see TamperGuard.kt) ─────────────────────
    // Defaults to FALSE ("never seen enabled") rather than TRUE, so a
    // freshly-enrolled device that hasn't completed the setup checklist
    // yet never fires a false "tampering" alert just for not having
    // turned a permission on for the first time — only a TRUE -> FALSE
    // flip (it WAS on, now it's off) counts as tampering.

    fun accessibilityWasEnabled(context: Context): Boolean =
        prefs(context).getBoolean("accessibility_was_enabled", false)

    fun setAccessibilityWasEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean("accessibility_was_enabled", enabled).apply()
    }

    fun deviceAdminWasActive(context: Context): Boolean =
        prefs(context).getBoolean("device_admin_was_active", false)

    fun setDeviceAdminWasActive(context: Context, active: Boolean) {
        prefs(context).edit().putBoolean("device_admin_was_active", active).apply()
    }

    /** Per-kind cooldown so repeated reminders for a still-off permission don't spam pc_alerts, but two DIFFERENT kinds never suppress each other. */
    fun lastTamperAlertAt(context: Context, kind: String): Long =
        prefs(context).getLong("last_tamper_alert_$kind", 0L)

    fun setLastTamperAlertAt(context: Context, kind: String, epochMillis: Long) {
        prefs(context).edit().putLong("last_tamper_alert_$kind", epochMillis).apply()
    }

    // ── Website filtering (see PolicyEnforcer.kt / InternetBlockVpnService.kt) ──

    /** Cached blocked-domain set from pc_website_rules (action='block'), refreshed each PolicyEnforcer pass. */
    fun blockedDomains(context: Context): Set<String> =
        prefs(context).getStringSet("website_blocked_domains", emptySet()) ?: emptySet()

    fun setBlockedDomains(context: Context, domains: Set<String>) {
        prefs(context).edit().putStringSet("website_blocked_domains", domains).apply()
    }

    /** True while PolicyEnforcer wants the DNS-filtering VPN mode running (there is at least one enabled block rule). */
    fun websiteFilterActive(context: Context): Boolean =
        prefs(context).getBoolean("website_filter_active", false)

    fun setWebsiteFilterActive(context: Context, active: Boolean) {
        prefs(context).edit().putBoolean("website_filter_active", active).apply()
    }
}
