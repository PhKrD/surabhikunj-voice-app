package com.surabhikunj.voice.dpc

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Store-and-forward for rows the parent must eventually receive: alerts
 * (tamper, SOS, limit reached, blocked attempts), SOS events and "more time"
 * requests.
 *
 * Before this, every such insert was fire-once: a child who pressed SOS in
 * a lift, or switched off Accessibility while in aeroplane mode, produced
 * nothing at all on the parent's side. Now each row gets a client-generated
 * UUID, is attempted immediately, and on failure waits here until the next
 * flush (monitor service reporting tick, network regained, screen on).
 * SupabaseRest.insertIdempotent treats a 409 on that id as "already
 * delivered", so a retry after a lost response never duplicates a row.
 */
object Outbox {
    private const val TAG = "VoiceKidsOutbox"
    private const val KEY = "outbox_v1"
    private const val MAX_ITEMS = 200
    private const val MAX_AGE_MS = 3L * 24 * 60 * 60_000

    private val lock = Any()

    /** Sends now if possible, otherwise queues. Blocking — call off the main thread. */
    // Tables whose created_at should be WHEN IT HAPPENED, not when a delayed
    // delivery finally landed (an SOS or tamper alert from 2 hours ago must
    // not show as "just now" on the parent's timeline).
    private val STAMP_CREATED_AT = setOf("pc_alerts", "pc_child_requests", "pc_bonus_time_requests")

    fun send(context: Context, table: String, row: JSONObject): Boolean {
        if (!row.has("id")) row.put("id", UUID.randomUUID().toString())
        if (table in STAMP_CREATED_AT && !row.has("created_at")) row.put("created_at", isoNow())
        if (SupabaseRest.insertIdempotent(context, table, row)) return true
        enqueue(context, table, row)
        return false
    }

    private fun enqueue(context: Context, table: String, row: JSONObject) {
        synchronized(lock) {
            val items = load(context)
            items.put(JSONObject().put("table", table).put("row", row).put("queued_at", System.currentTimeMillis()))
            while (items.length() > MAX_ITEMS) items.remove(0)
            VoiceKidsPrefs.putString(context, KEY, items.toString())
        }
        Log.i(TAG, "Queued $table row for later delivery")
    }

    fun pendingCount(context: Context): Int = synchronized(lock) { load(context).length() }

    /** Delivers queued rows oldest-first; stops at the first network failure. */
    fun flush(context: Context) {
        val snapshot = synchronized(lock) { load(context) }
        if (snapshot.length() == 0) return
        val now = System.currentTimeMillis()
        val delivered = HashSet<String>()
        for (i in 0 until snapshot.length()) {
            val item = snapshot.optJSONObject(i) ?: continue
            val row = item.optJSONObject("row") ?: continue
            val id = row.optString("id")
            if (now - item.optLong("queued_at", now) > MAX_AGE_MS) {
                delivered.add(id)
                continue
            }
            if (!SupabaseRest.insertIdempotent(context, item.optString("table"), row)) break
            delivered.add(id)
        }
        if (delivered.isEmpty()) return
        synchronized(lock) {
            val current = load(context)
            val kept = JSONArray()
            for (i in 0 until current.length()) {
                val item = current.optJSONObject(i) ?: continue
                if (item.optJSONObject("row")?.optString("id") !in delivered) kept.put(item)
            }
            VoiceKidsPrefs.putString(context, KEY, kept.toString())
        }
        Log.i(TAG, "Delivered ${delivered.size} queued row(s)")
    }

    private fun isoNow(): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())

    private fun load(context: Context): JSONArray =
        runCatching { JSONArray(VoiceKidsPrefs.getString(context, KEY) ?: "[]") }.getOrDefault(JSONArray())

    /** Standard pc_alerts row for this device. */
    fun alert(context: Context, type: String, severity: String, title: String, body: String, metadata: JSONObject? = null): Boolean {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return false
        val childId = VoiceKidsPrefs.childId(context) ?: return false
        val row = JSONObject()
            .put("child_id", childId)
            .put("device_id", deviceId)
            .put("alert_type", type)
            .put("severity", severity)
            .put("title", title)
            .put("body", body)
        if (metadata != null) row.put("metadata", metadata)
        return send(context, "pc_alerts", row)
    }
}
