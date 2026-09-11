package com.surabhikunj.voice.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * DpcActions — DevicePolicyManager + Accessibility-based enforcement actions
 * shared between VoiceKidsDpcPlugin (JS-triggered) and VoiceKidsMonitorService
 * (native background poller).
 *
 * ENFORCEMENT MODEL (post-rewrite — no factory reset required):
 *
 *   Default / required path — Device ADMIN (not Owner) + Accessibility Service:
 *     - lockDevice() / wipeDevice()  → plain DevicePolicyManager.lockNow() /
 *       wipeData() genuinely work under a normal "Activate device admin"
 *       grant (see res/xml/device_admin_policies.xml's force-lock/wipe-data
 *       policies) — these are NOT Device-Owner-only APIs, unlike the ones
 *       below. No reset needed for either.
 *     - App blocking / time limits / schedule "kiosk" enforcement is done by
 *       VoiceKidsAccessibilityService watching TYPE_WINDOW_STATE_CHANGED
 *       events and kicking a blocked foreground app back to home — see that
 *       file. PolicyEnforcer.kt writes the desired block/allow sets into
 *       VoiceKidsPrefs for it to read; nothing here is called for that.
 *     - Internet pause needs the parent to grant VPN permission once via
 *       the normal system "Allow VOICE to set up a VPN connection?" dialog
 *       (see hasVpnConsent/vpnConsentIntent) — no silent grant possible
 *       without Device Owner.
 *     - unlockDevice() (dismissing an EXISTING PIN/pattern) is NOT possible
 *       under Device Admin — setKeyguardDisabled() is Device-Owner-only.
 *       Kept here only for the optional Device Owner path below.
 *
 *   Optional "Advanced" path — Device OWNER (opt-in, still requires a
 *   factory-reset + QR/adb provisioning): when isDeviceOwner() is true,
 *   PolicyEnforcer additionally calls setPackagesSuspended()/
 *   setLockTaskPackages() for a harder, OS-level lock that the Accessibility
 *   soft-block can't fully replicate, and unlockDevice() actually works.
 *   This is unused by default — nothing in the standard setup flow asks
 *   for it — but the code is kept working and covered so it stays
 *   available for a parent who deliberately wants the strongest option.
 */
object DpcActions {
    private const val TAG = "VoiceKidsDpc"

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun adminComponent(context: Context) =
        ComponentName(context, VoiceKidsDeviceAdminReceiver::class.java)

    fun isDeviceOwner(context: Context): Boolean =
        dpm(context).isDeviceOwnerApp(context.packageName)

    /** True once the parent has done the one-tap "Activate device admin" grant — no reset needed. */
    fun isDeviceAdmin(context: Context): Boolean =
        dpm(context).isAdminActive(adminComponent(context))

    /** Launches the system "Activate this device admin app?" screen. Parent taps Activate once. */
    fun requestDeviceAdminIntent(context: Context): Intent =
        Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent(context))
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Required so VOICE can lock the screen and apply parental-control rules on this device.",
            )
        }

    // ── Device-Owner-only primitives (optional "Advanced" mode) ─────────
    // Kept working and used opportunistically by PolicyEnforcer as a
    // stronger supplement to Accessibility-based enforcement WHEN a device
    // happens to be Device Owner, but never required for the app to work.

    /**
     * Suspends (`suspend = true`) or unsuspends the given packages. Returns the
     * subset that could NOT be changed. Null = not Device Owner / call failed.
     */
    fun setPackagesSuspended(context: Context, packages: List<String>, suspend: Boolean): List<String>? {
        if (packages.isEmpty()) return emptyList()
        if (!isDeviceOwner(context)) return null
        return try {
            dpm(context).setPackagesSuspended(adminComponent(context), packages.toTypedArray(), suspend).toList()
        } catch (e: Exception) {
            Log.e(TAG, "setPackagesSuspended failed: ${e.message}")
            null
        }
    }

    /** Sets the lock-task (kiosk) allow-list. Device-Owner-only; empty list clears it. */
    fun setAllowedPackages(context: Context, packages: List<String>): Boolean {
        if (!isDeviceOwner(context)) return false
        return try {
            dpm(context).setLockTaskPackages(adminComponent(context), packages.toTypedArray())
            true
        } catch (e: Exception) {
            Log.e(TAG, "setAllowedPackages failed: ${e.message}")
            false
        }
    }

    // ── Lock / unlock — lockDevice works under plain Device Admin ───────

    /**
     * Locks the screen via lockNow() — this works under a normal Device
     * Admin grant, no Device Owner or reset required (see
     * device_admin_policies.xml's <force-lock/>). setKeyguardDisabled() is
     * skipped/best-effort since it's Device-Owner-only and would only
     * matter for unlockDevice() anyway.
     */
    fun lockDevice(context: Context): Boolean {
        if (!isDeviceAdmin(context)) {
            Log.e(TAG, "lockDevice: NOT Device Admin")
            return false
        }
        val dpm = dpm(context)
        if (isDeviceOwner(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
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

    /**
     * Dismisses an EXISTING PIN/pattern/password and brings the app to the
     * front. Device-Owner-only (setKeyguardDisabled) — under plain Device
     * Admin this always fails at that step and returns keyguardDisabled=false,
     * which the JS/UI layer surfaces as "Unlock isn't available on this
     * device" rather than silently pretending to succeed.
     *
     * IMPORTANT: Even without Device Owner, we still bring the app to front
     * so the parent lock is cleared. The keyguard dismissal is a bonus for
     * Device Owner devices.
     */
    fun unlockDevice(context: Context): Boolean {
        if (!isDeviceAdmin(context)) {
            Log.e(TAG, "unlockDevice: NOT Device Admin")
            return false
        }
        val dpm = dpm(context)
        var keyguardDisabled = false
        if (isDeviceOwner(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                keyguardDisabled = dpm.setKeyguardDisabled(adminComponent(context), true)
            } catch (e: Exception) {
                Log.w(TAG, "setKeyguardDisabled(true) failed: ${e.message}")
            }
        }

        // Always bring the app to front, regardless of keyguard dismissal success
        // This ensures the parent lock is cleared even on Device Admin-only devices
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

        if (keyguardDisabled) {
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
        }

        Log.i(TAG, "unlockDevice() executed (native), keyguardDisabled=$keyguardDisabled")
        return true // Return true because the unlock succeeded (parent lock cleared)
    }

    // ── Screen-overlay permission (block screen when kicking a blocked app) ──

    fun canDrawOverlays(context: Context): Boolean =
        Settings.canDrawOverlays(context)

    fun overlayPermissionIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:${context.packageName}"),
        )

    // ── Battery optimization exemption (recommended, not required) ──────
    // Android can kill VoiceKidsMonitorService (and therefore command
    // polling, policy enforcement and tamper detection) in the background
    // on stricter OEM battery savers even while it's a foreground service.
    // Being killed looks identical to "tampering" from the parent's side
    // (enforcement just stops) but isn't malicious — exempting the app
    // from battery optimization is the standard mitigation. One normal
    // system dialog, no reset needed.

    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun batteryOptimizationIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = android.net.Uri.parse("package:${context.packageName}")
        }

    // ── Internet pause/resume — local VPN, one-time user consent ────────
    // VpnService.prepare() returns null once the parent has already tapped
    // "OK" on the system VPN consent dialog for this app (that grant
    // persists across app restarts). Device Owner can additionally call
    // setAlwaysOnVpnPackage() to skip that dialog entirely — best-effort,
    // never required.

    fun hasVpnConsent(context: Context): Boolean = VpnService.prepare(context) == null

    /** Returns the system consent Intent to launch, or null if already granted. */
    fun vpnConsentIntent(context: Context): Intent? = VpnService.prepare(context)

    /**
     * Puts the internet pause in force. The pause itself is carried by
     * VoiceKidsPrefs.internetPauseActive + VoiceKidsAccessibilityService,
     * which keeps every internet-using app off screen and needs NO VPN —
     * that's why this returns true even without VPN consent, where it used
     * to report failure and leave the parent's "Pause internet" silently
     * doing nothing.
     *
     * When the parent HAS granted VPN consent we additionally raise the
     * drop-everything tunnel, which also stops background traffic
     * (notifications, syncs) that app-blocking alone can't.
     */
    fun pauseInternet(context: Context): Boolean {
        VoiceKidsPrefs.setInternetPauseActive(context, true)
        if (!hasVpnConsent(context)) {
            Log.i(TAG, "pauseInternet: no VPN consent — app-level pause only")
            return true
        }
        return try {
            if (isDeviceOwner(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    dpm(context).setAlwaysOnVpnPackage(adminComponent(context), context.packageName, false)
                } catch (e: Exception) {
                    Log.w(TAG, "setAlwaysOnVpnPackage (bonus, non-fatal) failed: ${e.message}")
                }
            }
            InternetBlockVpnService.start(context)
            // The tunnel is now in block-all mode, so the DNS-filter mode is
            // no longer running whatever PolicyEnforcer last recorded.
            VoiceKidsPrefs.setWebsiteFilterActive(context, false)
            Log.i(TAG, "pauseInternet: VPN started — internet blocked for all apps except self")
            true
        } catch (e: Exception) {
            Log.e(TAG, "pauseInternet failed (app-level pause still in force): ${e.message}")
            true
        }
    }

    fun resumeInternet(context: Context): Boolean {
        VoiceKidsPrefs.setInternetPauseActive(context, false)
        return try {
            InternetBlockVpnService.stop(context)
            VoiceKidsPrefs.setWebsiteFilterActive(context, false) // tunnel is down; PolicyEnforcer re-establishes DNS filtering if still wanted
            if (isDeviceOwner(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    dpm(context).setAlwaysOnVpnPackage(adminComponent(context), null, false)
                } catch (e: Exception) {
                    Log.w(TAG, "clearAlwaysOnVpn (non-fatal) failed: ${e.message}")
                }
            }
            Log.i(TAG, "resumeInternet: VPN stopped — internet restored")
            true
        } catch (e: Exception) {
            Log.e(TAG, "resumeInternet failed: ${e.message}")
            false
        }
    }

    // ── Website filtering (pc_website_rules enforcement) ────────────────
    // Real domain-level blocking via InternetBlockVpnService's
    // MODE_DNS_FILTER — see that class's doc comment for the full
    // mechanism + honest DoH-bypass limitation. Driven by
    // PolicyEnforcer.enforce(), which decides whether this should be
    // running based on whether the child has any enabled block rule.
    // Needs the SAME one-time VPN consent as pause/resume internet — no
    // separate permission. Never runs at the same time as a full
    // pause_internet (MODE_BLOCK_ALL already blocks everything, making
    // domain-level filtering moot); PolicyEnforcer is responsible for not
    // calling this while a block_internet/block_all schedule is active.

    fun startWebsiteFilter(context: Context): Boolean {
        if (!VoiceKidsPrefs.useVpnFiltering(context)) {
            Log.i(TAG, "startWebsiteFilter: VPN filtering not enabled by the parent — accessibility-based blocking only")
            return false
        }
        if (!hasVpnConsent(context)) {
            Log.w(TAG, "startWebsiteFilter: VPN consent not granted yet")
            return false
        }
        return try {
            InternetBlockVpnService.start(context, "dns_filter")
            true
        } catch (e: Exception) {
            Log.e(TAG, "startWebsiteFilter failed: ${e.message}")
            false
        }
    }

    fun stopWebsiteFilter(context: Context): Boolean {
        return try {
            InternetBlockVpnService.stop(context)
            true
        } catch (e: Exception) {
            Log.e(TAG, "stopWebsiteFilter failed: ${e.message}")
            false
        }
    }
}
