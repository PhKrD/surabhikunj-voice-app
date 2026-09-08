package com.surabhikunj.voice.dpc

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.view.accessibility.AccessibilityManager

/**
 * Shared "is VoiceKidsAccessibilityService actually turned on" check, used by
 * both VoiceKidsAccessibilityPlugin (JS-facing status/settings deep-link) and
 * PolicyEnforcer (reported into pc_devices.enforcement_state so the parent UI
 * can show it in the diagnostic checklist).
 */
object AccessibilityStatus {
    fun isEnabled(context: Context): Boolean {
        val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
            ?: return false
        val enabledServices = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        return enabledServices.any {
            it.resolveInfo?.serviceInfo?.packageName == context.packageName &&
                it.resolveInfo?.serviceInfo?.name == VoiceKidsAccessibilityService::class.java.name
        }
    }
}
