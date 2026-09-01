package com.surabhikunj.voice.dpc

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * SupabaseRest
 *
 * Minimal REST client so the background foreground service can talk to
 * Supabase's PostgREST + Auth endpoints WITHOUT depending on the WebView/JS
 * runtime being alive. Used for location + (later) usage-stat reporting.
 *
 * All calls are synchronous — always invoke from a background thread
 * (VoiceKidsMonitorService already does this via a single-thread executor).
 */
object SupabaseRest {
    private const val TAG = "VoiceKidsRest"

    /** POST a single row. Retries once after a token refresh on 401. Returns true on success. */
    fun insert(context: Context, table: String, body: JSONObject): Boolean {
        val result = request(context, "POST", "/rest/v1/$table", body.toString(), extraHeaders = mapOf("Prefer" to "return=minimal"))
        return result != null
    }

    /**
     * POST a batch of rows with upsert semantics (insert-or-update on conflict).
     * `conflictColumns` must match a UNIQUE constraint on the table
     * (e.g. "device_id,package_name,usage_date" for pc_app_usage_events).
     */
    fun upsert(context: Context, table: String, rows: JSONArray, conflictColumns: String): Boolean {
        if (rows.length() == 0) return true
        val result = request(
            context,
            "POST",
            "/rest/v1/$table?on_conflict=$conflictColumns",
            rows.toString(),
            extraHeaders = mapOf("Prefer" to "resolution=merge-duplicates,return=minimal"),
        )
        return result != null
    }

    /** GET rows matching a PostgREST query string (e.g. "child_id=eq.<id>&is_active=eq.true&select=*"). */
    fun get(context: Context, table: String, query: String): JSONArray? {
        val result = request(context, "GET", "/rest/v1/$table?$query", null)
        return result?.let {
            try { JSONArray(it) } catch (e: Exception) {
                Log.e(TAG, "Failed to parse GET response: ${e.message}")
                null
            }
        }
    }

    /**
     * PATCH rows matching a PostgREST filter (e.g. "id=eq.<uuid>"). Real UPDATE, not
     * upsert — required for tables like pc_device_commands where the device has an
     * UPDATE policy but no INSERT policy (an upsert via POST is RLS-checked as an
     * INSERT first, so it's rejected with 42501 even though the row already exists).
     *
     * java.net.HttpURLConnection's setRequestMethod() rejects "PATCH" outright
     * (ProtocolException: it's not in its hardcoded method whitelist), so the method
     * is forced via reflection on the underlying HttpURLConnection — a long-standing,
     * widely-used workaround for this exact JDK/Android limitation.
     */
    fun patch(context: Context, table: String, filterQuery: String, body: JSONObject): Boolean {
        val result = request(
            context,
            "PATCH",
            "/rest/v1/$table?$filterQuery",
            body.toString(),
            extraHeaders = mapOf("Prefer" to "return=minimal"),
        )
        return result != null
    }

    private fun forcePatchMethod(conn: HttpURLConnection) {
        try {
            conn.requestMethod = "PATCH"
            return // succeeded on this Android/JDK version — no workaround needed
        } catch (e: java.net.ProtocolException) {
            // Fall through to the reflection workaround below.
        }
        try {
            // HttpURLConnection delegates to a "delegate"/"httpEngine" instance on some
            // implementations; walk up through setDelegate chains and just force the
            // "method" field wherever it lives.
            var target: Any = conn
            var field = try {
                target.javaClass.getDeclaredField("method")
            } catch (e: NoSuchFieldException) {
                null
            }
            if (field == null) {
                // com.android.okhttp.internal.huc.DelegatingHttpsURLConnection / HttpURLConnectionImpl
                val delegateField = target.javaClass.superclass?.getDeclaredField("delegate")
                if (delegateField != null) {
                    delegateField.isAccessible = true
                    val delegate = delegateField.get(target)
                    if (delegate != null) {
                        target = delegate
                        field = target.javaClass.getDeclaredField("method")
                    }
                }
            }
            field?.isAccessible = true
            field?.set(target, "PATCH")
        } catch (e: Exception) {
            Log.e(TAG, "Could not force PATCH method: ${e.message}")
        }
    }

    /** Refreshes the access token using the stored refresh token. Returns true on success. */
    fun refreshAccessToken(context: Context): Boolean {
        val supabaseUrl = VoiceKidsPrefs.supabaseUrl(context) ?: return false
        val anonKey = VoiceKidsPrefs.anonKey(context) ?: return false
        val refreshToken = VoiceKidsPrefs.refreshToken(context) ?: return false

        return try {
            val url = URL("$supabaseUrl/auth/v1/token?grant_type=refresh_token")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", anonKey)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000

            val body = JSONObject().put("refresh_token", refreshToken)
            OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }

            val code = conn.responseCode
            if (code in 200..299) {
                val text = conn.inputStream.bufferedReader().use(BufferedReader::readText)
                val json = JSONObject(text)
                val newAccess = json.getString("access_token")
                val newRefresh = json.getString("refresh_token")
                VoiceKidsPrefs.updateTokens(context, newAccess, newRefresh)
                Log.i(TAG, "Access token refreshed")
                true
            } else {
                Log.e(TAG, "Token refresh failed: HTTP $code")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Token refresh error: ${e.message}")
            false
        }
    }

    // ── Internal ────────────────────────────────────────────────────────

    private fun request(
        context: Context,
        method: String,
        path: String,
        body: String?,
        extraHeaders: Map<String, String> = emptyMap(),
        isRetry: Boolean = false,
    ): String? {
        val supabaseUrl = VoiceKidsPrefs.supabaseUrl(context) ?: return null
        val anonKey = VoiceKidsPrefs.anonKey(context) ?: return null
        val accessToken = VoiceKidsPrefs.accessToken(context) ?: return null

        return try {
            val url = URL("$supabaseUrl$path")
            val conn = url.openConnection() as HttpURLConnection
            if (method == "PATCH") forcePatchMethod(conn) else conn.requestMethod = method
            conn.setRequestProperty("apikey", anonKey)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.setRequestProperty("Content-Type", "application/json")
            extraHeaders.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000

            if (body != null) {
                conn.doOutput = true
                OutputStreamWriter(conn.outputStream).use { it.write(body) }
            }

            val code = conn.responseCode
            when {
                code in 200..299 -> {
                    conn.inputStream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
                }
                code == 401 && !isRetry -> {
                    // Access token expired — refresh once and retry.
                    if (refreshAccessToken(context)) {
                        request(context, method, path, body, extraHeaders, isRetry = true)
                    } else null
                }
                else -> {
                    val err = try {
                        conn.errorStream?.bufferedReader()?.use(BufferedReader::readText)
                    } catch (e: Exception) { null }
                    Log.e(TAG, "$method $path failed: HTTP $code $err")
                    null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "$method $path error: ${e.message}")
            null
        }
    }
}
