package com.surabhikunj.voice.dpc

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.util.Log
import org.json.JSONObject

/**
 * SosReporter — native side of the child's SOS button.
 *
 * Exists because the WebView path (src/lib/sosApi.js) depends on the JS
 * Supabase client having a live session, and SOS is precisely the moment
 * that must not matter. SupabaseRest refreshes the device's token by
 * itself, so this keeps working when the WebView session is stale.
 *
 * Location is opportunistic: the last known fix is read synchronously (no
 * waiting on a GPS lock, which can take 30s+ indoors) and null coordinates
 * are perfectly acceptable — telling the parent something is wrong NOW
 * matters more than telling them exactly where.
 *
 * Call from a background thread — every SupabaseRest call is blocking.
 */
object SosReporter {
    private const val TAG = "VoiceKidsSos"

    fun fire(context: Context, notes: String, latitude: Double?, longitude: Double?): Boolean {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return false
        val childId = VoiceKidsPrefs.childId(context) ?: return false

        var lat = latitude
        var lon = longitude
        var accuracy: Float? = null
        if (lat == null || lon == null) {
            lastKnownLocation(context)?.let {
                lat = it.latitude
                lon = it.longitude
                accuracy = it.accuracy
            }
        }

        val event = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("latitude", lat ?: JSONObject.NULL)
            put("longitude", lon ?: JSONObject.NULL)
            put("accuracy_meters", accuracy ?: JSONObject.NULL)
            if (notes.isNotEmpty()) put("notes", notes)
        }
        val eventOk = SupabaseRest.insert(context, "pc_sos_events", event)

        val alert = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("alert_type", "sos")
            put("severity", "critical")
            put("title", "SOS — Immediate attention needed")
            put("body", notes.ifEmpty { "Your child pressed the SOS button." })
            put("metadata", JSONObject().put("latitude", lat ?: JSONObject.NULL).put("longitude", lon ?: JSONObject.NULL))
        }
        // The alert is what actually reaches the parent (push + dashboard),
        // so a successful alert counts as a delivered SOS even if the
        // pc_sos_events row failed.
        val alertOk = SupabaseRest.insert(context, "pc_alerts", alert)
        if (!eventOk || !alertOk) Log.w(TAG, "SOS partial failure: event=$eventOk alert=$alertOk")
        return eventOk || alertOk
    }

    @SuppressLint("MissingPermission")
    private fun lastKnownLocation(context: Context): android.location.Location? {
        val granted = context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return null
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.getProviders(true)
                .mapNotNull { lm.getLastKnownLocation(it) }
                .maxByOrNull { it.time }
        } catch (e: Exception) {
            Log.w(TAG, "lastKnownLocation failed: ${e.message}")
            null
        }
    }
}
