package com.surabhikunj.voice.dpc

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * VoiceKidsLocationPlugin
 *
 * JS-facing control for the always-on background monitoring service
 * (VoiceKidsMonitorService). The service itself talks to Supabase directly
 * via SupabaseRest — this plugin's job is just to:
 *   1. Persist the current Supabase session into VoiceKidsPrefs so the
 *      native service can authenticate independently of the WebView.
 *   2. Request the runtime location permissions.
 *   3. Start/stop the foreground service.
 */
@CapacitorPlugin(
    name = "VoiceKidsLocation",
    permissions = [
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION], alias = "backgroundLocation"),
    ],
)
class VoiceKidsLocationPlugin : Plugin() {

    @PluginMethod
    fun updateSession(call: PluginCall) {
        val supabaseUrl = call.getString("supabaseUrl")
        val anonKey = call.getString("anonKey")
        val deviceId = call.getString("deviceId")
        val childId = call.getString("childId")
        val orgId = call.getString("orgId")
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")

        if (supabaseUrl == null || anonKey == null || deviceId == null || childId == null ||
            orgId == null || accessToken == null || refreshToken == null
        ) {
            call.reject("Missing required session fields")
            return
        }

        val independent = call.getBoolean("independentSession", false) == true
        val previousDevice = VoiceKidsPrefs.deviceId(context)
        val previousChild = VoiceKidsPrefs.childId(context)
        if (independent || !VoiceKidsPrefs.hasIndependentSession(context) || previousDevice != deviceId ||
            VoiceKidsPrefs.sessionInvalidSince(context) != 0L) {
            // Fresh pairing, a session minted for native (pc-device-session),
            // or native's own session died: take these tokens.
            VoiceKidsPrefs.saveSession(context, supabaseUrl, anonKey, deviceId, childId, orgId, accessToken, refreshToken)
            VoiceKidsPrefs.setIndependentSession(context, independent)
            VoiceKidsPrefs.setSessionInvalidSince(context, 0L)
        } else {
            // Native already owns its own token family. Taking the WebView's
            // tokens would put two refreshers on one token chain again — the
            // bug that silently logged supervised phones out. Identity only.
            VoiceKidsPrefs.updateIdentity(context, deviceId, childId, orgId)
        }
        if (previousDevice != deviceId) VoiceKidsPrefs.putString(context, "revoked", null)
        if (previousChild != childId) PolicyEnforcer.invalidateCache()
        val result = successResult()
        result.put("independentSession", VoiceKidsPrefs.hasIndependentSession(context))
        call.resolve(result)
    }

    /** Whether native holds its own session, and whether that session still works. */
    @PluginMethod
    fun getSessionState(call: PluginCall) {
        val result = JSObject()
        result.put("configured", VoiceKidsPrefs.isConfigured(context))
        result.put("deviceId", VoiceKidsPrefs.deviceId(context))
        result.put("independentSession", VoiceKidsPrefs.hasIndependentSession(context))
        result.put("sessionInvalidSince", VoiceKidsPrefs.sessionInvalidSince(context))
        result.put("revoked", PolicyEnforcer.isRevoked(context))
        call.resolve(result)
    }

    @PluginMethod
    fun startTracking(call: PluginCall) {
        startService()
        val result = successResult()
        result.put("hasLocationPermission", hasLocationPermission())
        call.resolve(result)
    }

    @PermissionCallback
    private fun locationPermsCallback(call: PluginCall) {
        if (hasLocationPermission()) {
            startService()
            call.resolve(successResult())
        } else {
            val result = JSObject()
            result.put("success", false)
            result.put("reason", "permission_denied")
            call.resolve(result)
        }
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        context.stopService(Intent(context, VoiceKidsMonitorService::class.java))
        call.resolve(successResult())
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        context.stopService(Intent(context, VoiceKidsMonitorService::class.java))
        val suspended = VoiceKidsPrefs.appliedSuspended(context).toList()
        if (suspended.isNotEmpty()) DpcActions.setPackagesSuspended(context, suspended, false)
        if (DpcActions.isDeviceOwner(context)) DpcActions.setAllowedPackages(context, emptyList())
        DpcActions.resumeInternet(context)
        VoiceKidsPrefs.clear(context)
        PolicyEnforcer.invalidateCache()
        call.resolve(successResult())
    }

    @PluginMethod
    fun isTracking(call: PluginCall) {
        val result = JSObject()
        result.put("configured", VoiceKidsPrefs.isConfigured(context))
        result.put("hasLocationPermission", hasLocationPermission())
        call.resolve(result)
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startService() {
        val intent = Intent(context, VoiceKidsMonitorService::class.java)
        ContextCompat.startForegroundService(context, intent)
    }

    private fun successResult(): JSObject {
        val result = JSObject()
        result.put("success", true)
        return result
    }
}
