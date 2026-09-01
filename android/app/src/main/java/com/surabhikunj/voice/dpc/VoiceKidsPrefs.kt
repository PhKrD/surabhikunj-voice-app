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
}
