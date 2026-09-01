package com.surabhikunj.voice.dpc

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * VoiceKidsDpcPlugin
 *
 * Bridges the web layer to Android's DevicePolicyManager (DPC) APIs.
 * Every method degrades gracefully when the app is NOT Device Owner —
 * it returns { success: false, reason: "not_device_owner" } instead of
 * throwing, so the JS command handler can surface a clear alert to the
 * parent ("this device needs to be re-enrolled as Device Owner").
 *
 * Enforcement primitives used:
 *   - setPackagesSuspended()   → per-app block (pc_app_rules action=block)
 *   - setLockTaskPackages() +
 *     startLockTask()          → allow-list-only kiosk mode (routines)
 *   - setPackagesSuspended()      → pause/resume internet by suspending all
 *                                   non-system user apps (child cannot open any app).
 *   - lockNow()                → immediate screen lock (lock_device command)
 *   - wipeData()               → factory_reset command (parent-confirmed only)
 *
 * All of these are Device Owner–only APIs (they silently no-op or throw
 * SecurityException under plain Device Admin), which is why the
 * architecture requires QR provisioning at factory-reset time.
 */
@CapacitorPlugin(name = "VoiceKidsDpc")
class VoiceKidsDpcPlugin : Plugin() {

    private lateinit var dpm: DevicePolicyManager
    private lateinit var adminComponent: ComponentName

    override fun load() {
        super.load()
        dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        adminComponent = ComponentName(context, VoiceKidsDeviceAdminReceiver::class.java)
    }

    // ── Status ──────────────────────────────────────────────────────────

    @PluginMethod
    fun isDeviceOwner(call: PluginCall) {
        val result = JSObject()
        result.put("isDeviceOwner", dpm.isDeviceOwnerApp(context.packageName))
        result.put("isDeviceAdmin", dpm.isAdminActive(adminComponent))
        call.resolve(result)
    }

    /** Returns the QR-provisioning JSON the parent app should render for factory-reset setup. */
    @PluginMethod
    fun getProvisioningPayload(call: PluginCall) {
        val json = JSObject()
        json.put("android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME", adminComponent.flattenToString())
        json.put("android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION",
            "https://your-cdn.example.com/voice-kids-release.apk") // TODO: real APK hosting URL
        json.put("android.app.extra.PROVISIONING_SKIP_ENCRYPTION", false)
        json.put("android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED", true)
        call.resolve(json)
    }

    // ── App suspension (per-app block rules) ───────────────────────────

    @PluginMethod
    fun suspendPackages(call: PluginCall) {
        val packages = call.getArray("packages")
        if (packages == null) { call.reject("packages array required"); return }
        runDeviceOwnerAction(call) {
            val arr = jsArrayToStringArray(packages)
            val failed = dpm.setPackagesSuspended(adminComponent, arr, true)
            val result = JSObject()
            result.put("success", true)
            result.put("failed", stringArrayToJSArray(failed))
            call.resolve(result)
        }
    }

    @PluginMethod
    fun unsuspendPackages(call: PluginCall) {
        val packages = call.getArray("packages")
        if (packages == null) { call.reject("packages array required"); return }
        runDeviceOwnerAction(call) {
            val arr = jsArrayToStringArray(packages)
            val failed = dpm.setPackagesSuspended(adminComponent, arr, false)
            val result = JSObject()
            result.put("success", true)
            result.put("failed", stringArrayToJSArray(failed))
            call.resolve(result)
        }
    }

    // ── Lock-task / kiosk allow-list (routines: allow_list_only) ───────

    @PluginMethod
    fun setAllowedPackages(call: PluginCall) {
        val packages = call.getArray("packages")
        if (packages == null) { call.reject("packages array required"); return }
        runDeviceOwnerAction(call) {
            val arr = jsArrayToStringArray(packages)
            dpm.setLockTaskPackages(adminComponent, arr)
            call.resolve(successResult())
        }
    }

    @PluginMethod
    fun startKioskMode(call: PluginCall) {
        runDeviceOwnerAction(call) {
            activity?.startLockTask()
            call.resolve(successResult())
        }
    }

    @PluginMethod
    fun stopKioskMode(call: PluginCall) {
        runDeviceOwnerAction(call) {
            activity?.stopLockTask()
            call.resolve(successResult())
        }
    }

    // ── Connectivity (pause_internet / resume_internet commands) ───────

    @PluginMethod
    fun pauseInternet(call: PluginCall) {
        android.util.Log.d("VoiceKidsDpc", "pauseInternet called")
        // Delegates to DpcActions which starts InternetBlockVpnService — a local VPN that
        // drops all packets for every app except our own (so we keep Supabase access).
        runDeviceOwnerAction(call) {
            val success = DpcActions.pauseInternet(context)
            android.util.Log.d("VoiceKidsDpc", "pauseInternet result: $success")
            val result = JSObject()
            result.put("success", success)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun resumeInternet(call: PluginCall) {
        android.util.Log.d("VoiceKidsDpc", "resumeInternet called")
        // Delegates to DpcActions which stops InternetBlockVpnService → internet restored.
        runDeviceOwnerAction(call) {
            val success = DpcActions.resumeInternet(context)
            android.util.Log.d("VoiceKidsDpc", "resumeInternet result: $success")
            val result = JSObject()
            result.put("success", success)
            call.resolve(result)
        }
    }

    // ── Lock / wipe (lock_device / factory_reset commands) ─────────────

    @PluginMethod
    fun lockDevice(call: PluginCall) {
        android.util.Log.d("VoiceKidsDpc", "lockDevice called")
        runDeviceOwnerAction(call) {
            // Re-enable the keyguard so the lock actually requires dismissal on wake.
            // (A prior unlock_device disables it — without this, lockNow just turns the
            //  screen off and the next power-press goes straight to the home screen.)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                try {
                    dpm.setKeyguardDisabled(adminComponent, false)
                    android.util.Log.d("VoiceKidsDpc", "setKeyguardDisabled(false) - keyguard re-enabled")
                } catch (e: Exception) {
                    android.util.Log.w("VoiceKidsDpc", "setKeyguardDisabled(false) failed: ${e.message}")
                }
            }
            dpm.lockNow()
            android.util.Log.d("VoiceKidsDpc", "lockNow() executed")
            call.resolve(successResult())
        }
    }

    @PluginMethod
    fun unlockDevice(call: PluginCall) {
        android.util.Log.d("VoiceKidsDpc", "unlockDevice called")
        runDeviceOwnerAction(call) {
            // 1. Dismiss the keyguard. Device Owner can disable it when no PIN is set.
            //    DO NOT use ACTION_CLOSE_SYSTEM_DIALOGS (requires BROADCAST_CLOSE_SYSTEM_DIALOGS,
            //    a system-only permission on Android 12+).
            var keyguardDisabled = false
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                try {
                    keyguardDisabled = dpm.setKeyguardDisabled(adminComponent, true)
                    android.util.Log.d("VoiceKidsDpc", "setKeyguardDisabled(true) = $keyguardDisabled")
                } catch (e: Exception) {
                    android.util.Log.w("VoiceKidsDpc", "setKeyguardDisabled failed: ${e.message}")
                }
            }

            // 2. WAKE the screen. This is the critical step that was missing — dismissing
            //    the keyguard alone leaves the screen black/asleep. A wake lock with
            //    ACQUIRE_CAUSES_WAKEUP turns the display back on (WAKE_LOCK perm is declared).
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                @Suppress("DEPRECATION")
                val wakeLock = pm.newWakeLock(
                    android.os.PowerManager.FULL_WAKE_LOCK or
                        android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        android.os.PowerManager.ON_AFTER_RELEASE,
                    "VoiceKidsDpc:unlock"
                )
                wakeLock.acquire(3000L)
                wakeLock.release()
                android.util.Log.d("VoiceKidsDpc", "wake lock acquired — screen woken")
            } catch (e: Exception) {
                android.util.Log.w("VoiceKidsDpc", "wake lock failed: ${e.message}")
            }

            // 3. Bring our activity to the front over the (now-dismissed) lock screen and
            //    keep the screen on for this launch.
            try {
                activity?.runOnUiThread {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
                        activity?.setShowWhenLocked(true)
                        activity?.setTurnScreenOn(true)
                    } else {
                        @Suppress("DEPRECATION")
                        activity?.window?.addFlags(
                            android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                                android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                        )
                    }
                    // Re-launch MainActivity so a backgrounded WebView is brought forward.
                    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                    launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    if (launch != null) context.startActivity(launch)
                }
            } catch (e: Exception) {
                android.util.Log.w("VoiceKidsDpc", "Screen-on/foreground failed: ${e.message}")
            }

            android.util.Log.d("VoiceKidsDpc", "unlockDevice() executed, keyguardDisabled=$keyguardDisabled")
            val result = JSObject()
            result.put("success", true)
            result.put("keyguardDisabled", keyguardDisabled)
            call.resolve(result)
        }
    }

    /**
     * DESTRUCTIVE. Only call after explicit parent confirmation server-side
     * (the pc_device_commands row for factory_reset should require a second
     * confirmation step before being marked pending).
     */
    @PluginMethod
    fun wipeDevice(call: PluginCall) {
        runDeviceOwnerAction(call) {
            dpm.wipeData(0)
            call.resolve(successResult())
        }
    }

    // ── User restrictions (bonus features) ─────────────────────────────

    @PluginMethod
    fun disallowFactoryReset(call: PluginCall) {
        runDeviceOwnerAction(call) {
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_FACTORY_RESET)
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_SAFE_BOOT)
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_UNINSTALL_APPS)
            call.resolve(successResult())
        }
    }

    /**
     * Device Owner can silently grant "dangerous" runtime permissions —
     * used so location/notification access doesn't require an interactive
     * prompt on a device the parent has already provisioned. Falls back to
     * the normal runtime permission flow automatically when this fails
     * (i.e. Device Admin mode, not Device Owner).
     */
    @PluginMethod
    fun grantRuntimePermissions(call: PluginCall) {
        runDeviceOwnerAction(call) {
            val permissions = listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS,
            )
            val granted = mutableListOf<String>()
            permissions.forEach { perm ->
                try {
                    dpm.setPermissionGrantState(
                        adminComponent,
                        context.packageName,
                        perm,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                    )
                    granted.add(perm)
                } catch (e: Exception) {
                    // Some permissions may not be grantable on this API level — ignore and continue.
                }
            }
            val result = JSObject()
            result.put("success", true)
            result.put("granted", stringArrayToJSArray(granted.toTypedArray()))
            call.resolve(result)
        }
    }

    // ── Bonus time (shared with the native PolicyEnforcer) ─────────────
    // commandPoller.js stores bonus expiry in localStorage, which the
    // native background enforcer (PolicyEnforcer, running in
    // VoiceKidsMonitorService) cannot read. This mirrors it into
    // SharedPreferences so bonus time lifts time_limit rules regardless of
    // whether the WebView or the native poller last processed the
    // grant/revoke_bonus_time command. Does not require Device Owner —
    // it's just a local pref write, not a DevicePolicyManager call.
    @PluginMethod
    fun setBonusExpiry(call: PluginCall) {
        val expiresAtIso = call.getString("expiresAt")
        val epoch = expiresAtIso?.let {
            try {
                java.time.Instant.parse(it).toEpochMilli()
            } catch (e: Exception) {
                null
            }
        }
        VoiceKidsPrefs.setBonusExpiresAt(context, epoch)
        call.resolve(successResult())
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun runDeviceOwnerAction(call: PluginCall, action: () -> Unit) {
        android.util.Log.d("VoiceKidsDpc", "runDeviceOwnerAction: checking Device Owner status")
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            android.util.Log.e("VoiceKidsDpc", "NOT Device Owner!")
            val result = JSObject()
            result.put("success", false)
            result.put("reason", "not_device_owner")
            call.resolve(result)
            return
        }
        android.util.Log.d("VoiceKidsDpc", "Device Owner confirmed. Executing action...")
        try {
            action()
        } catch (e: SecurityException) {
            android.util.Log.e("VoiceKidsDpc", "SecurityException: ${e.message}", e)
            val result = JSObject()
            result.put("success", false)
            result.put("reason", "security_exception: ${e.message}")
            call.resolve(result)
        } catch (e: Exception) {
            android.util.Log.e("VoiceKidsDpc", "Exception: ${e.message}", e)
            call.reject(e.message ?: "Unknown DPC error", e)
        }
    }

    private fun successResult(): JSObject {
        val result = JSObject()
        result.put("success", true)
        return result
    }

    private fun jsArrayToStringArray(arr: JSArray): Array<String> {
        val list = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            list.add(arr.getString(i))
        }
        return list.toTypedArray()
    }

    private fun stringArrayToJSArray(arr: Array<String>?): JSArray {
        val result = JSArray()
        arr?.forEach { result.put(it) }
        return result
    }
}
