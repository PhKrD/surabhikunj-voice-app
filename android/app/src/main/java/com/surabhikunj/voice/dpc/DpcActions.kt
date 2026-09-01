package com.surabhikunj.voice.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * DpcActions — DevicePolicyManager actions shared between:
 *   - VoiceKidsDpcPlugin  (Capacitor bridge, JS-triggered — only runs while
 *     the WebView/JS runtime is alive and the app is foregrounded)
 *   - VoiceKidsMonitorService (native background poller — keeps working even
 *     when the app is fully backgrounded, since Android suspends the JS
 *     setInterval-based poller after a short time in the background)
 *
 * Only needs an application Context — none of these DevicePolicyManager
 * calls require an Activity, and "bring the app to front" just starts a
 * new-task launch intent.
 */
object DpcActions {
    private const val TAG = "VoiceKidsDpc"

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun adminComponent(context: Context) =
        ComponentName(context, VoiceKidsDeviceAdminReceiver::class.java)

    fun isDeviceOwner(context: Context): Boolean =
        dpm(context).isDeviceOwnerApp(context.packageName)

    /**
     * Suspends (`suspend = true`) or unsuspends the given packages. Returns the
     * subset that could NOT be changed (per DevicePolicyManager semantics — e.g.
     * a package that isn't installed). Empty list = fully applied. Null = not
     * Device Owner / call failed outright.
     */
    fun setPackagesSuspended(context: Context, packages: List<String>, suspend: Boolean): List<String>? {
        if (packages.isEmpty()) return emptyList()
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "setPackagesSuspended (native): NOT Device Owner")
            return null
        }
        return try {
            dpm(context).setPackagesSuspended(adminComponent(context), packages.toTypedArray(), suspend).toList()
        } catch (e: Exception) {
            Log.e(TAG, "setPackagesSuspended failed: ${e.message}")
            null
        }
    }

    /** Sets the lock-task (kiosk) allow-list. Empty list clears it. */
    fun setAllowedPackages(context: Context, packages: List<String>): Boolean {
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "setAllowedPackages (native): NOT Device Owner")
            return false
        }
        return try {
            dpm(context).setLockTaskPackages(adminComponent(context), packages.toTypedArray())
            true
        } catch (e: Exception) {
            Log.e(TAG, "setAllowedPackages failed: ${e.message}")
            false
        }
    }

    fun lockDevice(context: Context): Boolean {
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "lockDevice (native): NOT Device Owner")
            return false
        }
        val dpm = dpm(context)
        // Re-enable the keyguard so the lock requires dismissal on wake (a
        // prior unlockDevice disables it).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                dpm.setKeyguardDisabled(adminComponent(context), false)
            } catch (e: Exception) {
                Log.w(TAG, "setKeyguardDisabled(false) failed: ${e.message}")
            }
        }
        return try {
            dpm.lockNow()
            Log.i(TAG, "lockNow() executed (native)")
            true
        } catch (e: Exception) {
            Log.e(TAG, "lockNow failed: ${e.message}")
            false
        }
    }

    fun unlockDevice(context: Context): Boolean {
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "unlockDevice (native): NOT Device Owner")
            return false
        }
        val dpm = dpm(context)
        var keyguardDisabled = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                keyguardDisabled = dpm.setKeyguardDisabled(adminComponent(context), true)
            } catch (e: Exception) {
                Log.w(TAG, "setKeyguardDisabled(true) failed: ${e.message}")
            }
        }

        // Wake the screen — dismissing the keyguard alone leaves it black/asleep.
        try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                "VoiceKidsDpc:unlock:native",
            )
            wakeLock.acquire(3000L)
            wakeLock.release()
        } catch (e: Exception) {
            Log.w(TAG, "wake lock failed: ${e.message}")
        }

        // Bring the app to the front so the child sees the (now-unlocked) home screen
        // instead of just the launcher/lock screen.
        try {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            launch?.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
            if (launch != null) context.startActivity(launch)
        } catch (e: Exception) {
            Log.w(TAG, "bring-to-front failed: ${e.message}")
        }

        Log.i(TAG, "unlockDevice() executed (native), keyguardDisabled=$keyguardDisabled")
        return true
    }

    /**
     * Pause internet by starting a local VPN that drops all packets for every app except
     * our own (so the monitoring service can still reach Supabase and receive the
     * resume_internet command even while the child has no internet access).
     *
     * Requires Android 7.0+ (API 24) for setAlwaysOnVpnPackage() which silently grants
     * VPN permission to the Device Owner app without a user dialog.
     */
    fun pauseInternet(context: Context): Boolean {
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "pauseInternet (native): NOT Device Owner")
            return false
        }
        return try {
            // Grant VPN permission silently as Device Owner so Builder.establish() succeeds
            // without needing a user-visible "Allow VPN?" dialog.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                dpm(context).setAlwaysOnVpnPackage(
                    adminComponent(context),
                    context.packageName,
                    /* lockdown= */ false,
                )
            }
            // Start the VPN service that routes all traffic through a black hole, but
            // exempts our own package so the background service keeps Supabase access.
            InternetBlockVpnService.start(context)
            Log.i(TAG, "pauseInternet (native): VPN started — internet blocked for all apps except self")
            true
        } catch (e: Exception) {
            Log.e(TAG, "pauseInternet failed: ${e.message}")
            false
        }
    }

    /**
     * Resume internet by stopping the blocking VPN and clearing the always-on VPN setting.
     */
    fun resumeInternet(context: Context): Boolean {
        if (!isDeviceOwner(context)) {
            Log.e(TAG, "resumeInternet (native): NOT Device Owner")
            return false
        }
        return try {
            // Stop the blocking VPN → traffic flows normally again.
            InternetBlockVpnService.stop(context)
            // Clear always-on VPN so a future reboot doesn't try to auto-restart it.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    dpm(context).setAlwaysOnVpnPackage(adminComponent(context), null, false)
                } catch (e: Exception) {
                    Log.w(TAG, "clearAlwaysOnVpn failed (non-fatal): ${e.message}")
                }
            }
            Log.i(TAG, "resumeInternet (native): VPN stopped — internet restored")
            true
        } catch (e: Exception) {
            Log.e(TAG, "resumeInternet failed: ${e.message}")
            false
        }
    }
}
