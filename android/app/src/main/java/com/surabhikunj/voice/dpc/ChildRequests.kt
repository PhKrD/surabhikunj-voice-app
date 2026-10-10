package com.surabhikunj.voice.dpc

import android.content.Context
import org.json.JSONObject

/**
 * "Ask for more time" written natively, so it works from the block screen
 * even when the WebView is asleep, and is queued (Outbox) when offline.
 * The parent approves it in the app; approval is delivered as desired state
 * (pc_children.bonus_expires_at), so it reaches the phone even if it was
 * offline at that moment.
 */
object ChildRequests {
    /** @return true if delivered now; false if queued for when the phone is back online. */
    fun requestMoreTime(context: Context, minutes: Int, what: String?, reason: String): Boolean {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return false
        val childId = VoiceKidsPrefs.childId(context) ?: return false
        val contextText = when (reason) {
            "daily_limit" -> "Daily screen time is up"
            "app_limit" -> "${what ?: "App"} time limit reached"
            "schedule" -> "${VoiceKidsPrefs.lockLabel(context).ifEmpty { "A routine" }} is on"
            "restricted_time" -> "Restricted time"
            "internet_paused" -> "Internet is paused"
            "website_blocked" -> "Blocked website: ${what ?: ""}"
            else -> if (what != null) "$what is blocked" else "Blocked app"
        }
        val request = JSONObject()
            .put("child_id", childId)
            .put("device_id", deviceId)
            .put("requested_min", minutes)
            .put("reason", contextText)
        val requestOk = Outbox.send(context, "pc_bonus_time_requests", request)
        val alertOk = Outbox.alert(
            context, "bonus_time_requested", "info",
            "Asked for $minutes more minutes",
            contextText,
            JSONObject().put("requested_min", minutes).put("context", reason).put("request_id", request.optString("id")),
        )
        return requestOk && alertOk
    }

    /**
     * "Ask to unblock" for a hard-blocked app or website. Extra time does not
     * lift a parent's block, so offering "more time" there was a dead end.
     * Structured metadata (exact package / domain) lets the parent's approval
     * add the matching allow rule instead of guessing from free text.
     */
    fun requestAccess(context: Context, pkg: String?, appLabel: String?, domain: String?): Boolean {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return false
        val childId = VoiceKidsPrefs.childId(context) ?: return false
        val isSite = domain != null
        val what = if (isSite) domain!! else appLabel ?: pkg ?: "an app"
        val meta = JSONObject()
        if (isSite) meta.put("domain", domain) else meta.put("package_name", pkg).put("app_name", appLabel ?: pkg)
        val request = JSONObject()
            .put("child_id", childId)
            .put("device_id", deviceId)
            .put("request_type", if (isSite) "website_access" else "app_unblock")
            .put("reason", "Asked to use $what")
            .put("metadata", meta)
        val requestOk = Outbox.send(context, "pc_child_requests", request)
        val alertOk = Outbox.alert(
            context, "bonus_time_requested", "info", "Asked to use $what",
            if (isSite) "Wants access to the website $what." else "Wants $what unblocked.",
            JSONObject(meta.toString()).put("request_id", request.optString("id")),
        )
        return requestOk && alertOk
    }
}
