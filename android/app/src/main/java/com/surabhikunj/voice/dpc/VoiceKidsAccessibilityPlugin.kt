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

    /**
     * Opens the Accessibility grant for VOICE.
     *
     * Android does not let any app — Device Owner included — switch an
     * accessibility service on for itself, so a trip to Settings is
     * unavoidable here. What we CAN avoid is making the parent hunt for
     * VOICE in a long list: passing the service's component id through
     * :settings:fragment_args_key + :settings:show_fragment_args makes
     * AOSP Settings (and most OEM forks) open VOICE's own toggle page
     * directly, highlighted. If that extra is ignored we simply land on
     * the normal Accessibility list, which is the old behaviour.
     */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        SettingsGuard.allowAppInitiatedVisit(context)
        val component = "${context.packageName}/${VoiceKidsAccessibilityService::class.java.name}"
        val deepLink = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(":settings:fragment_args_key", component)
            putExtra(
                ":settings:show_fragment_args",
                android.os.Bundle().apply { putString(":settings:fragment_args_key", component) },
            )
        }
        try {
            context.startActivity(deepLink)
            call.resolve(JSObject().apply { put("success", true) })
        } catch (e: Exception) {
            try {
                context.startActivity(
                    Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                call.resolve(JSObject().apply { put("success", true) })
            } catch (e2: Exception) {
                call.reject("Could not open accessibility settings: ${e2.message}")
            }
        }
    }

}
