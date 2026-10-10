package com.surabhikunj.voice.dpc

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * VoiceKidsMonitorService
 *
 * Foreground service that keeps parental-control enforcement alive when the
 * WebView/JS runtime is suspended or the app is fully backgrounded:
 *
 *   1. Requests periodic GPS updates (FusedLocationProviderClient) and POSTs
 *      each fix to pc_location_events directly via SupabaseRest — no JS
 *      involvement required.
 *   2. Compares the fix against the child's cached pc_geofences (fetched on
 *      service start, refreshed every REFRESH_GEOFENCES_MS) and writes
 *      pc_geofence_events + a pc_alerts row on enter/exit transitions.
 *
 * Started by:
 *   - VoiceKidsLocationPlugin.startTracking() right after enrollment / app launch
 *   - BootReceiver after device reboot (if previously enrolled)
 */
class VoiceKidsMonitorService : Service() {

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var executor: ExecutorService
    private var locationCallback: LocationCallback? = null

    // geofence_id -> was-inside (for enter/exit edge detection)
    private val geofenceState = mutableMapOf<String, Boolean>()
    private var geofencesLoadedAt = 0L

    private var lastUsageReportAt = 0L
    private var lastInstalledAppsSyncAt = 0L

    // ── Native command polling (survives WebView/JS suspension) ────────
    // Android throttles/suspends a backgrounded WebView's JS setInterval
    // timers, so commandPoller.js alone can leave pause_internet/lock_device/
    // etc. stuck "pending" indefinitely whenever the child app isn't the
    // foreground activity. This foreground service polls independently and
    // executes those commands directly via DevicePolicyManager (DpcActions),
    // so they take effect regardless of what the WebView is doing.
    private val commandHandler = android.os.Handler(Looper.getMainLooper())
    private var commandPollingActive = false
    private val pendingCommandFirstSeen = mutableMapOf<String, Long>()
    private val tickBusy = java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile private var lastCommandPollAt = 0L

    private fun isInteractive(): Boolean =
        runCatching { getSystemService(android.os.PowerManager::class.java)?.isInteractive ?: true }.getOrDefault(true)

    /**
     * One adaptive tick replaces the two fixed 4-second loops (command poll
     * + policy pass), which made ~3 network calls every 4 seconds around
     * the clock. Local evaluation still runs every few seconds while the
     * screen is on (bedtime starts on time, a limit trips promptly); the
     * network reads inside it are spaced out (PolicyEnforcer), and with the
     * screen off everything slows to a crawl. Screen-on and network-regained
     * events trigger an immediate fresh read, so nothing feels delayed.
     */
    private val tickRunnable = object : Runnable {
        override fun run() {
            scheduleTick(force = false)
            if (!commandPollingActive) return
            // Wake exactly when extra time or the current restriction ends,
            // not up to a full idle interval later.
            val regular = if (isInteractive()) TICK_ACTIVE_MS else TICK_IDLE_MS
            val now = System.currentTimeMillis()
            val boundary = listOf(VoiceKidsPrefs.bonusExpiresAt(applicationContext), VoiceKidsPrefs.lockUntil(applicationContext))
                .filter { it > now }.minOrNull()
            val delay = boundary?.let { minOf(regular, it - now + 500) } ?: regular
            commandHandler.postDelayed(this, delay.coerceAtLeast(1_000L))
        }
    }

    private fun scheduleTick(force: Boolean) {
        if (!tickBusy.compareAndSet(false, true)) return
        executor.execute {
            try {
                val ctx = applicationContext
                val now = System.currentTimeMillis()
                val pollEvery = if (isInteractive()) COMMAND_POLL_ACTIVE_MS else COMMAND_POLL_IDLE_MS
                if (force || now - lastCommandPollAt >= pollEvery) {
                    lastCommandPollAt = now
                    pollAndExecuteCommands()
                }
                PolicyEnforcer.enforce(ctx, force)
                TamperGuard.check(ctx)
                if (force) Outbox.flush(ctx)
            } catch (e: Exception) {
                Log.e(TAG, "tick failed: ${e.message}")
            } finally {
                tickBusy.set(false)
            }
        }
    }

    // Screen on / unlocked: the child is about to use the phone — read fresh state now.
    private val screenReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: Intent?) {
            PolicyEnforcer.invalidateChildRow()
            scheduleTick(force = false)
        }
    }

    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null

    private fun registerWakeTriggers() {
        runCatching {
            val filter = android.content.IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
                addAction(Intent.ACTION_TIME_CHANGED)
                addAction(Intent.ACTION_TIMEZONE_CHANGED)
                addAction(Intent.ACTION_DATE_CHANGED)
            }
            ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        }
        runCatching {
            val cm = getSystemService(android.net.ConnectivityManager::class.java)
            val cb = object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    // Back online: deliver queued alerts/SOS and pick up
                    // anything the parent changed while we were offline.
                    PolicyEnforcer.invalidateChildRow()
                    PolicyEnforcer.markReportStale()
                    commandHandler.postDelayed({ scheduleTick(force = true) }, 1500)
                }
            }
            cm?.registerDefaultNetworkCallback(cb)
            networkCallback = cb
        }
    }

    private fun unregisterWakeTriggers() {
        runCatching { unregisterReceiver(screenReceiver) }
        networkCallback?.let { cb ->
            runCatching { getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) }
        }
        networkCallback = null
    }

    // ── Periodic reporting (independent of GPS fixes) ──────────────────
    // Usage stats and the installed-apps inventory do NOT depend on location,
    // and location itself must still be reported even when continuous GPS
    // updates aren't arriving (indoors, GPS off, or on an emulator that never
    // pushes fixes). Previously all of this was driven solely by the
    // FusedLocation callback, so a device that never got a fix reported
    // nothing at all. This independent timer guarantees usage/app/location
    // data flows on its own cadence regardless of the location provider.
    private val reportingHandler = android.os.Handler(Looper.getMainLooper())
    private var reportingActive = false

    private val reportingRunnable = object : Runnable {
        override fun run() {
            executor.execute {
                runCatching {
                    sendHeartbeat()
                    Outbox.flush(applicationContext)
                    fetchAndReportLastLocation()
                    reportUsageIfDue()
                    syncInstalledAppsIfDue()
                }.onFailure { Log.e(TAG, "reporting tick failed: ${it.message}") }
            }
            if (reportingActive) reportingHandler.postDelayed(this, REPORTING_INTERVAL_MS)
        }
    }

    // ── Tamper detection: near-instant reaction to the Accessibility
    // toggle specifically, via a ContentObserver on the Settings key
    // Android itself updates the instant a service is enabled/disabled —
    // much faster than waiting for the next POLICY_ENFORCE_INTERVAL_MS
    // poll tick. See TamperGuard.kt.
    private var accessibilitySettingObserver: ContentObserver? = null

    private fun registerTamperObserver() {
        if (accessibilitySettingObserver != null) return
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                executor.execute { TamperGuard.check(applicationContext) }
            }
        }
        accessibilitySettingObserver = observer
        try {
            contentResolver.registerContentObserver(
                Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
                false,
                observer,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not register tamper ContentObserver: ${e.message}")
        }
    }

    private fun unregisterTamperObserver() {
        accessibilitySettingObserver?.let {
            try { contentResolver.unregisterContentObserver(it) } catch (e: Exception) { /* already gone */ }
        }
        accessibilitySettingObserver = null
    }

    /**
     * Updates pc_devices.last_seen_at so the parent dashboard can show an
     * accurate online/offline indicator even when the WebView (and its JS
     * heartbeat) is suspended. Runs on every reporting tick (~60s). The
     * device has UPDATE RLS on its own pc_devices row.
     */
    private fun sendHeartbeat() {
        val context = applicationContext
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        SupabaseRest.patch(
            context,
            "pc_devices",
            "id=eq.$deviceId",
            JSONObject().put("last_seen_at", isoTimestamp(System.currentTimeMillis())),
        )
    }

    override fun onCreate() {
        super.onCreate()
        executor = Executors.newSingleThreadExecutor()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        startForegroundSafely()
        registerTamperObserver()
        registerWakeTriggers()
        Log.i(TAG, "Monitor service started")
    }

    /**
     * The manifest declares foregroundServiceType="location|dataSync". On
     * API 34+, Android throws a SecurityException from startForeground()
     * if the LOCATION type is used without ACCESS_FINE/COARSE_LOCATION
     * already granted — which, under the default (Device Admin only, no
     * Device Owner) setup, is a normal runtime permission the parent may
     * not have granted yet, not something that can be silently guaranteed.
     * Falling back to the DATA_SYNC type keeps this service (and therefore
     * command polling / policy enforcement — the source of truth
     * VoiceKidsAccessibilityService's app-block enforcement depends on)
     * running regardless. Letting this throw would crash the whole
     * process, taking VoiceKidsAccessibilityService down with it since
     * they share a process.
     */
    private fun startForegroundSafely() {
        val hasLocationPermission =
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification())
            return
        }
        // Android refuses some types depending on HOW we were started (e.g.
        // location from a boot broadcast without background-location access,
        // or dataSync from BOOT_COMPLETED on Android 15+). Try each type the
        // manifest declares before giving up; whichever is accepted keeps
        // enforcement alive.
        val types = buildList {
            if (hasLocationPermission) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            add(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        }
        for (type in types) {
            try {
                startForeground(NOTIF_ID, buildNotification(), type)
                VoiceKidsPrefs.putString(this, "fgs_type", if (type == ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) "location" else "dataSync")
                return
            } catch (e: Exception) {
                Log.w(TAG, "startForeground(type=$type) refused: ${e.message}")
            }
        }
        // Not allowed right now (started from the background). The
        // accessibility service restarts us as soon as it is bound, and the
        // app does when opened. Recorded for the parent's device-health view.
        VoiceKidsPrefs.putLong(this, "fgs_refused_at", System.currentTimeMillis())
        stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (VoiceKidsPrefs.isConfigured(applicationContext)) {
            startLocationUpdates()
            startCommandPolling()
            startPeriodicReporting()
        } else {
            Log.w(TAG, "No session configured — stopping (not enrolled yet)")
            stopSelf()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        locationCallback?.let { fusedClient.removeLocationUpdates(it) }
        stopCommandPolling()
        stopPeriodicReporting()
        unregisterTamperObserver()
        unregisterWakeTriggers()
        executor.shutdown()
        Log.i(TAG, "Monitor service stopped")
    }

    private fun startCommandPolling() {
        if (commandPollingActive) return
        commandPollingActive = true
        commandHandler.post(tickRunnable)
        Log.i(TAG, "Adaptive command polling + policy enforcement started")
    }

    private fun stopCommandPolling() {
        commandPollingActive = false
        commandHandler.removeCallbacks(tickRunnable)
    }

    private fun startPeriodicReporting() {
        if (reportingActive) return
        reportingActive = true
        reportingHandler.post(reportingRunnable)
        Log.i(TAG, "Periodic reporting started")
    }

    private fun stopPeriodicReporting() {
        reportingActive = false
        reportingHandler.removeCallbacks(reportingRunnable)
    }

    /**
     * Best-effort location report that does NOT rely on continuous GPS updates.
     * Uses the fused provider's cached last-known location so we still get a
     * position (and geofence evaluation) even when onLocationResult never fires
     * — e.g. GPS off, indoors, or on an emulator that doesn't push fixes.
     */
    private fun fetchAndReportLastLocation() {
        try {
            fusedClient.lastLocation.addOnSuccessListener { loc ->
                if (loc == null) return@addOnSuccessListener
                executor.execute {
                    reportLocation(loc)
                    checkGeofences(loc)
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "lastLocation permission denied: ${e.message}")
        }
    }

    /**
     * Polls pc_device_commands for lock/unlock/pause/resume and executes
     * them natively. A command is only claimed once it has been observed
     * "pending" for NATIVE_CLAIM_DELAY_MS — this gives the (faster, 2s)
     * commandPoller.js in the WebView first chance to handle it when the
     * app is in the foreground, preserving its nice UI navigation
     * (/locked <-> /home). If the WebView poller isn't running (app
     * backgrounded/suspended), this claims and executes the command
     * instead, guaranteeing enforcement either way.
     */
    private fun pollAndExecuteCommands() {
        val context = applicationContext
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context)

        val typesFilter = NATIVE_COMMAND_TYPES.joinToString(",")
        // Pick up pending commands, plus commands stuck in 'delivered'
        // (ACKed but never confirmed executed) past STUCK_DELIVERED_MS so a
        // crash mid-execution doesn't strand them. Retries are safe: all
        // native command types (lock/unlock/pause/resume) are idempotent.
        val stuckBefore = isoTimestamp(System.currentTimeMillis() - STUCK_DELIVERED_MS)
        val statusFilter =
            "or=(status.eq.pending,and(status.eq.delivered,executed_at.is.null,delivered_at.lt.$stuckBefore))"
        val commands = SupabaseRest.get(
            context,
            "pc_device_commands",
            "device_id=eq.$deviceId&command_type=in.($typesFilter)&$statusFilter&order=created_at.asc&select=*",
        ) ?: return

        val seenIds = mutableSetOf<String>()
        for (i in 0 until commands.length()) {
            val cmd = commands.getJSONObject(i)
            val commandId = cmd.optString("id", "")
            if (commandId.isEmpty()) continue
            val expiresAt = cmd.optString("expires_at", "").takeIf { it.isNotEmpty() && it != "null" }
                ?.let { parseIsoToEpochMillis(it) }
            if (expiresAt != null && expiresAt <= System.currentTimeMillis()) {
                pendingCommandFirstSeen.remove(commandId)
                continue
            }
            seenIds.add(commandId)

            val firstSeen = pendingCommandFirstSeen.getOrPut(commandId) { System.currentTimeMillis() }
            if (System.currentTimeMillis() - firstSeen < NATIVE_CLAIM_DELAY_MS) continue

            executeNativeCommand(context, deviceId, childId, cmd)
            pendingCommandFirstSeen.remove(commandId)
        }
        // Forget commands that are no longer pending (claimed by the JS poller, or already executed).
        pendingCommandFirstSeen.keys.retainAll(seenIds)
    }

    private fun executeNativeCommand(context: android.content.Context, deviceId: String, childId: String?, cmd: JSONObject) {
        val commandId = cmd.getString("id")
        val commandType = cmd.getString("command_type")

        SupabaseRest.patch(
            context,
            "pc_device_commands",
            "id=eq.$commandId",
            JSONObject().put("status", "delivered").put("delivered_at", isoTimestamp(System.currentTimeMillis())),
        )

        val success = when (commandType) {
            "lock_device" -> {
                // Persistent parent lock (see VoiceKidsDpcPlugin.lockDevice) +
                // an immediate screen lock. The persistent part never needs
                // Device Admin, so the command "succeeds" as long as the
                // Accessibility soft-lock can carry it; lockNow() is a bonus.
                VoiceKidsPrefs.setParentLockActive(context, true)
                DpcActions.lockDevice(context)
                true
            }
            "unlock_device" -> {
                VoiceKidsPrefs.setParentLockActive(context, false)
                DpcActions.unlockDevice(context) // This function checks Device Admin internally
                true
            }
            "pause_internet" -> {
                // Persistent until resume_internet — see VoiceKidsPrefs.manualInternetPause.
                // The pause holds even without VPN consent: the accessibility
                // service keeps internet apps off screen. So it succeeded if
                // either layer can carry it, and only fails if neither can.
                VoiceKidsPrefs.setManualInternetPause(context, true)
                val tunnel = DpcActions.hasVpnConsent(context) && DpcActions.pauseInternet(context)
                tunnel || AccessibilityStatus.isEnabled(context)
            }
            "resume_internet" -> {
                VoiceKidsPrefs.setManualInternetPause(context, false)
                DpcActions.resumeInternet(context)
            }
            "grant_bonus_time" -> {
                val expiresAt = cmd.optJSONObject("payload")?.optString("expires_at")?.takeIf { it.isNotEmpty() }
                val epoch = expiresAt?.let { parseIsoToEpochMillis(it) }
                VoiceKidsPrefs.setBonusExpiresAt(context, epoch)
                true
            }
            "revoke_bonus_time" -> {
                VoiceKidsPrefs.setBonusExpiresAt(context, null)
                true
            }
            else -> false
        }
        Log.i(TAG, "Native command executed: $commandType id=$commandId success=$success")

        SupabaseRest.patch(
            context,
            "pc_device_commands",
            "id=eq.$commandId",
            JSONObject().apply {
                put("status", if (success) "executed" else "failed")
                put("executed_at", isoTimestamp(System.currentTimeMillis()))
                put("error_message", if (success) JSONObject.NULL else "native_execution_failed")
            },
        )

        // Lock/bonus commands change what PolicyEnforcer should be doing —
        // apply immediately instead of waiting for the next 4s tick. After
        // the ack above so the parent sees "executed" without waiting for
        // the (network-bound) enforcement pass.
        VoiceKidsPrefs.putString(context, "last_command", "$commandType:${if (success) "executed" else "failed"}")
        VoiceKidsPrefs.putLong(context, "last_command_at", System.currentTimeMillis())
        if (success) {
            PolicyEnforcer.markReportStale()
            runCatching { PolicyEnforcer.enforce(context, force = true) }
        }

        if (!success && childId != null) {
            Outbox.alert(
                context, "device_offline", "warning",
                "${commandLabel(commandType)} didn't work",
                "The child's phone couldn't carry this out. Open Device health in VOICE to see which permission is missing.",
                JSONObject().put("command_id", commandId).put("command_type", commandType),
            )
        }
    }

    private fun commandLabel(type: String): String = when (type) {
        "lock_device" -> "Lock phone"
        "unlock_device" -> "Unlock phone"
        "pause_internet" -> "Pause internet"
        "resume_internet" -> "Resume internet"
        "grant_bonus_time" -> "Extra time"
        "revoke_bonus_time" -> "Ending extra time"
        else -> "A command"
    }

    // ── Location ─────────────────────────────────────────────────────────

    private fun startLocationUpdates() {
        if (locationCallback != null) return // already running

        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, LOCATION_INTERVAL_MS)
            .setMinUpdateIntervalMillis(LOCATION_MIN_INTERVAL_MS)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { onNewLocation(it) }
            }
        }

        try {
            fusedClient.requestLocationUpdates(request, locationCallback!!, Looper.getMainLooper())
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission not granted: ${e.message}")
        }
    }

    private fun onNewLocation(location: Location) {
        // Real GPS fixes: report position + evaluate geofences immediately.
        // Usage/installed-apps reporting is handled by the independent
        // periodic timer (startPeriodicReporting) so it runs even when no
        // location fixes arrive.
        executor.execute {
            reportLocation(location)
            checkGeofences(location)
        }
    }

    // ── App usage reporting (Step 5) ────────────────────────────────────

    private fun reportUsageIfDue() {
        val now = System.currentTimeMillis()
        if (now - lastUsageReportAt < USAGE_REPORT_INTERVAL_MS) return
        lastUsageReportAt = now

        val context = applicationContext
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return

        if (!UsageStatsHelper.hasUsageAccess(context)) {
            Log.w(TAG, "Usage access not granted — skipping usage report")
            return
        }

        val usageDate = isoDate(System.currentTimeMillis())
        val rows = JSONArray()
        UsageStatsHelper.queryTodayUsage(context).forEach { u ->
            val row = JSONObject().apply {
                put("device_id", deviceId)
                put("child_id", childId)
                put("package_name", u.packageName)
                put("app_name", u.appName)
                put("usage_date", usageDate)
                put("total_foreground_ms", u.totalForegroundMs)
                if (u.firstUseAt > 0) put("first_use_at", isoTimestamp(u.firstUseAt))
                if (u.lastUseAt > 0) put("last_use_at", isoTimestamp(u.lastUseAt))
            }
            rows.put(row)
        }

        val ok = SupabaseRest.upsert(context, "pc_app_usage_events", rows, "device_id,package_name,usage_date")
        if (ok) Log.i(TAG, "Reported app usage: ${rows.length()} apps")
        else Log.w(TAG, "Failed to report app usage")
    }

    private fun syncInstalledAppsIfDue() {
        val now = System.currentTimeMillis()
        if (now - lastInstalledAppsSyncAt < INSTALLED_APPS_SYNC_INTERVAL_MS) return
        lastInstalledAppsSyncAt = now

        val context = applicationContext
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return

        val rows = JSONArray()
        UsageStatsHelper.queryInstalledApps(context).forEach { app ->
            val row = JSONObject().apply {
                put("device_id", deviceId)
                put("package_name", app.packageName)
                put("app_name", app.appName)
                if (app.versionName != null) put("version_name", app.versionName)
                put("is_system_app", app.isSystemApp)
                if (app.installedAt > 0) put("installed_at", isoTimestamp(app.installedAt))
                put("last_seen_at", isoTimestamp(System.currentTimeMillis()))
            }
            rows.put(row)
        }

        val ok = SupabaseRest.upsert(context, "pc_installed_apps", rows, "device_id,package_name")
        if (ok) Log.i(TAG, "Synced installed apps: ${rows.length()} apps")
        else Log.w(TAG, "Failed to sync installed apps")
    }

    private fun reportLocation(location: Location) {
        val context = applicationContext
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return

        // The cached fix is re-read every minute; only store a point when it
        // is a NEW fix that moved meaningfully, or as a periodic "still here"
        // (previously the same fix was inserted 60 times an hour).
        val lastTime = VoiceKidsPrefs.getLong(context, "loc_last_time")
        if (location.time == lastTime) return
        val lastLat = VoiceKidsPrefs.getString(context, "loc_last_lat")?.toDoubleOrNull()
        val lastLon = VoiceKidsPrefs.getString(context, "loc_last_lon")?.toDoubleOrNull()
        val lastInsertAt = VoiceKidsPrefs.getLong(context, "loc_last_insert_at")
        if (lastLat != null && lastLon != null) {
            val moved = haversineMeters(lastLat, lastLon, location.latitude, location.longitude)
            val threshold = maxOf(25.0, (if (location.hasAccuracy()) location.accuracy.toDouble() else 50.0))
            if (moved < threshold && System.currentTimeMillis() - lastInsertAt < LOCATION_STILL_HERE_MS) return
        }
        VoiceKidsPrefs.putLong(context, "loc_last_time", location.time)

        val body = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            if (location.hasAccuracy()) put("accuracy_meters", location.accuracy)
            if (location.hasSpeed()) put("speed_mps", location.speed)
            if (location.hasAltitude()) put("altitude_meters", location.altitude)
            put("recorded_at", isoTimestamp(location.time))
        }

        val ok = SupabaseRest.insert(context, "pc_location_events", body)
        if (ok) {
            VoiceKidsPrefs.putString(context, "loc_last_lat", location.latitude.toString())
            VoiceKidsPrefs.putString(context, "loc_last_lon", location.longitude.toString())
            VoiceKidsPrefs.putLong(context, "loc_last_insert_at", System.currentTimeMillis())
        } else {
            Log.w(TAG, "Failed to report location")
        }
    }

    // ── Geofencing (checked in software against cached geofences) ─────────

    private fun checkGeofences(location: Location) {
        val context = applicationContext
        refreshGeofencesIfStale(context)

        val geofences = cachedGeofences ?: return
        if (geofenceState.isEmpty()) loadGeofenceState(context)
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else 50.0
        var changed = false
        for (i in 0 until geofences.length()) {
            val gf = geofences.getJSONObject(i)
            val id = gf.getString("id")
            val lat = gf.getDouble("latitude")
            val lng = gf.getDouble("longitude")
            val radius = gf.getDouble("radius_meters")

            val distance = haversineMeters(location.latitude, location.longitude, lat, lng)
            // Hysteresis + accuracy gate (PolicyRules.geofenceInside): GPS
            // wobble around the edge used to fire Arrived / Left / Arrived.
            val wasInside = geofenceState[id]
            val isInside = PolicyRules.geofenceInside(distance, radius, accuracy, wasInside) ?: continue

            if (wasInside == null) {
                // First reading for this place (new place, fresh install,
                // service restart): learn where we are without announcing an
                // "arrival" that never happened.
                geofenceState[id] = isInside
                changed = true
                continue
            }
            if (isInside != wasInside) {
                geofenceState[id] = isInside
                changed = true
                val eventType = if (isInside) "enter" else "exit"
                val shouldNotify = if (isInside) gf.optBoolean("notify_arrival", true) else gf.optBoolean("notify_departure", true)
                recordGeofenceEvent(context, gf, eventType, location, shouldNotify)
            }
        }
        if (changed) saveGeofenceState(context)
    }

    private fun loadGeofenceState(context: android.content.Context) {
        val raw = VoiceKidsPrefs.getString(context, "geofence_state") ?: return
        runCatching {
            val j = JSONObject(raw)
            j.keys().forEach { geofenceState[it] = j.getBoolean(it) }
        }
    }

    private fun saveGeofenceState(context: android.content.Context) {
        val j = JSONObject()
        geofenceState.forEach { (k, v) -> j.put(k, v) }
        VoiceKidsPrefs.putString(context, "geofence_state", j.toString())
    }

    private var cachedGeofences: org.json.JSONArray? = null

    private fun refreshGeofencesIfStale(context: android.content.Context) {
        val now = System.currentTimeMillis()
        if (cachedGeofences != null && now - geofencesLoadedAt < REFRESH_GEOFENCES_MS) return

        val childId = VoiceKidsPrefs.childId(context) ?: return
        val result = SupabaseRest.get(
            context,
            "pc_geofences",
            "child_id=eq.$childId&is_active=eq.true&select=id,name,latitude,longitude,radius_meters,notify_arrival,notify_departure",
        )
        if (result != null) {
            cachedGeofences = result
            geofencesLoadedAt = now
        }
    }

    private fun recordGeofenceEvent(
        context: android.content.Context,
        geofence: JSONObject,
        eventType: String,
        location: Location,
        notify: Boolean,
    ) {
        val deviceId = VoiceKidsPrefs.deviceId(context) ?: return
        val childId = VoiceKidsPrefs.childId(context) ?: return
        val geofenceId = geofence.getString("id")
        val geofenceName = geofence.optString("name", "a location")

        val eventBody = JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("geofence_id", geofenceId)
            put("event_type", eventType)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("occurred_at", isoTimestamp(location.time))
        }
        Outbox.send(context, "pc_geofence_events", eventBody)

        if (!notify) return

        val time = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(Date(location.time))
        Outbox.alert(
            context,
            if (eventType == "enter") "geofence_enter" else "geofence_exit",
            "info",
            if (eventType == "enter") "Arrived at $geofenceName" else "Left $geofenceName",
            "At $time",
            JSONObject().put("geofence_id", geofenceId).put("latitude", location.latitude).put("longitude", location.longitude),
        )
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_000.0 // Earth radius in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2).let { it * it } +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLon / 2).let { it * it }
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return r * c
    }

    private fun isoTimestamp(epochMillis: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(epochMillis))
    }

    /** Parses a Supabase/Postgres ISO timestamp (e.g. "2026-09-01T12:00:00+00:00") to epoch millis. */
    private fun parseIsoToEpochMillis(iso: String): Long? {
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
        for (pattern in formats) {
            try {
                val sdf = SimpleDateFormat(pattern, Locale.US)
                if (pattern.endsWith("'Z'")) sdf.timeZone = TimeZone.getTimeZone("UTC")
                return sdf.parse(iso)?.time
            } catch (e: Exception) {
                // try next pattern
            }
        }
        Log.w(TAG, "Could not parse ISO timestamp: $iso")
        return null
    }

    /** Device-local calendar date (matches pc_app_usage_events.usage_date, a DATE column). */
    private fun isoDate(epochMillis: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        return sdf.format(Date(epochMillis))
    }

    // ── Notification helpers ───────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "VOICE Kids monitoring",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps parental controls active"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("VOICE supervision is on")
            .setContentText("Your parent's settings are active on this phone")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "VoiceKidsMonitor"
        private const val NOTIF_ID = 1001
        private const val CHANNEL_ID = "voice_kids_monitor"

        private const val LOCATION_INTERVAL_MS = 5 * 60 * 1000L      // 5 min
        private const val LOCATION_MIN_INTERVAL_MS = 2 * 60 * 1000L  // 2 min
        private const val REFRESH_GEOFENCES_MS = 30 * 60 * 1000L     // 30 min

        private const val USAGE_REPORT_INTERVAL_MS = 15 * 60 * 1000L         // 15 min
        private const val INSTALLED_APPS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000L // 24 hr

        private const val REPORTING_INTERVAL_MS = 60_000L     // periodic reporting tick (usage/apps/location gated by their own due-intervals)

        private const val LOCATION_STILL_HERE_MS = 15 * 60 * 1000L   // store an unchanged position at most this often

        // Local policy evaluation cadence (no network) — see tickRunnable.
        private const val TICK_ACTIVE_MS = 4_000L
        private const val TICK_IDLE_MS = 30_000L
        // Command polling (network) cadence.
        private const val COMMAND_POLL_ACTIVE_MS = 8_000L
        private const val COMMAND_POLL_IDLE_MS = 60_000L
        private const val NATIVE_CLAIM_DELAY_MS = 5_000L      // let the foreground JS poller (2s) win first
        private const val STUCK_DELIVERED_MS = 30_000L        // retry commands stuck in 'delivered' past this
        private val NATIVE_COMMAND_TYPES = listOf(
            "lock_device", "unlock_device", "pause_internet", "resume_internet",
            "grant_bonus_time", "revoke_bonus_time",
        )
    }
}
