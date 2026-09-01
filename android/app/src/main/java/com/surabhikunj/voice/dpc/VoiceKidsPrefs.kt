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
}
