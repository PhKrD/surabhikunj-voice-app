package com.surabhikunj.voice.dpc

import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * VoiceKidsAccessibilityPlugin
 *
 * JS-facing status check + Settings deep-link for
 * VoiceKidsAccessibilityService (best-effort web/search monitoring).
 * PACKAGE_USAGE_STATS-style "special access" permission: cannot be granted
 * programmatically by any app, including a Device Owner — the parent must
 * flip it on once under Settings > Accessibility on the child device.
 * This mirrors VoiceKidsUsageStatsPlugin's openUsageAccessSettings() shape.
 */
@CapacitorPlugin(name = "VoiceKidsAccessibility")
class VoiceKidsAccessibilityPlugin : Plugin() {

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val result = JSObject()
        result.put("enabled", AccessibilityStatus.isEnabled(context))
        call.resolve(result)
    }

    /** Opens Settings > Accessibility so the parent can enable "VOICE" once. */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val result = JSObject()
            result.put("success", true)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Could not open accessibility settings: ${e.message}")
        }
    }

}
