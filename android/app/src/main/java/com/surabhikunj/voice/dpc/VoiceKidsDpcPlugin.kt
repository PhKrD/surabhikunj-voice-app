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
 * Bridges the web layer to Android's DevicePolicyManager (DPC) APIs, plus
 * the handful of special-access permissions the no-factory-reset
 * enforcement model needs (overlay, VPN consent). See DpcActions.kt's doc
 * comment for the full enforcement model.
 *
 * Two tiers of methods:
 *   - Device-ADMIN-gated (default, no reset required): lockDevice,
 *     unlockDevice (best-effort — see DpcActions.unlockDevice), pauseInternet/
 *     resumeInternet (also needs one-time VPN consent), wipeDevice. These
 *     return { success: false, reason: "not_device_admin" } when the parent
 *     hasn't done the one-tap "Activate device admin" grant yet.
 *   - Device-OWNER-gated (optional "Advanced" mode, still requires a
 *     factory-reset + provisioning): suspendPackages/unsuspendPackages,
 *     setAllowedPackages/startKioskMode/stopKioskMode, disallowFactoryReset,
 *     grantRuntimePermissions. Return { success: false, reason:
 *     "not_device_owner" } otherwise. App-blocking and schedule enforcement
 *     do NOT depend on these — see VoiceKidsAccessibilityService, which is
 *     the primary mechanism for both tiers.
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

    /**
     * Launches the system "Activate this device admin app?" screen — a
     * normal one-tap permission grant on an already-set-up phone, NOT
     * factory-reset provisioning. This is the default setup path.
     */
    @PluginMethod
    fun requestDeviceAdmin(call: PluginCall) {
        try {
            activity?.startActivityForResult(DpcActions.requestDeviceAdminIntent(context), 0)
                ?: context.startActivity(DpcActions.requestDeviceAdminIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(successResult())
        } catch (e: Exception) {
            call.reject("Could not open device admin activation: ${e.message}")
        }
    }

    /** Returns the QR-provisioning JSON for the OPTIONAL Device Owner "Advanced" setup (still requires a factory reset). */
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

    // ── Overlay permission (block-screen shown when kicking a blocked app) ──

    @PluginMethod
    fun canDrawOverlays(call: PluginCall) {
        val result = JSObject()
        result.put("granted", DpcActions.canDrawOverlays(context))
        call.resolve(result)
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        try {
            context.startActivity(DpcActions.overlayPermissionIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(successResult())
        } catch (e: Exception) {
            call.reject("Could not open overlay permission settings: ${e.message}")
        }
    }

    // ── Battery optimization exemption (recommended, not required) ──────

    @PluginMethod
    fun isIgnoringBatteryOptimizations(call: PluginCall) {
        val result = JSObject()
        result.put("granted", DpcActions.isIgnoringBatteryOptimizations(context))
        call.resolve(result)
    }

    @PluginMethod
    fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        try {
            context.startActivity(DpcActions.batteryOptimizationIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(successResult())
        } catch (e: Exception) {
            call.reject("Could not open battery optimization settings: ${e.message}")
        }
    }

    // ── VPN consent (one-time, needed for pause/resume internet) ────────

    @PluginMethod
    fun hasVpnConsent(call: PluginCall) {
        val result = JSObject()
        result.put("granted", DpcActions.hasVpnConsent(context))
        call.resolve(result)
    }

    /** Launches the system VPN consent dialog if not already granted; no-ops (resolves success) if already granted. */
    @PluginMethod
    fun requestVpnConsent(call: PluginCall) {
        val intent = DpcActions.vpnConsentIntent(context)
        if (intent == null) {
            call.resolve(successResult())
            return
        }
        try {
            activity?.startActivityForResult(intent, 0)
                ?: context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(successResult())
        } catch (e: Exception) {
            call.reject("Could not open VPN consent dialog: ${e.message}")
        }
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
    // Device-ADMIN-gated is not quite right either — pauseInternet only
    // needs the one-time VPN consent (DpcActions.hasVpnConsent), not Device
    // Admin at all. resumeInternet never needs any elevated permission.

    @PluginMethod
    fun pauseInternet(call: PluginCall) {
        val success = DpcActions.pauseInternet(context)
        // Persistent until resumeInternet — see VoiceKidsPrefs.manualInternetPause.
        if (success) VoiceKidsPrefs.setManualInternetPause(context, true)
        val result = JSObject()
        result.put("success", success)
        if (!success) result.put("reason", "vpn_consent_needed")
        call.resolve(result)
    }

    @PluginMethod
    fun resumeInternet(call: PluginCall) {
        VoiceKidsPrefs.setManualInternetPause(context, false)
        val success = DpcActions.resumeInternet(context)
        enforceExecutor.execute { runCatching { PolicyEnforcer.enforce(context.applicationContext) } }
        val result = JSObject()
        result.put("success", success)
        call.resolve(result)
    }

    // ── Lock / unlock / wipe (lock_device / unlock_device / factory_reset) ──
    // Device-ADMIN-gated (not Owner) — lockNow()/wipeData() genuinely work
    // under a plain Device Admin grant. unlockDevice degrades honestly: it
    // resolves success=false, keyguardDisabled=false when this device isn't
    // Device Owner, since dismissing an EXISTING PIN needs that API — see
    // DpcActions.unlockDevice's doc comment.

    /**
     * Parent's "Lock now": a PERSISTENT lock (Qustodio semantics) — every
     * app except the emergency dialer/VOICE is kept off-screen by
     * VoiceKidsAccessibilityService until "Unlock now", plus one immediate
     * lockNow() so the screen goes dark right away. The persistent part
     * needs no Device Admin at all; only the lockNow() does.
     */
    @PluginMethod
    fun lockDevice(call: PluginCall) {
        VoiceKidsPrefs.setParentLockActive(context, true)
        enforceExecutor.execute { runCatching { PolicyEnforcer.enforce(context.applicationContext) } }
        runDeviceAdminAction(call) {
            val success = DpcActions.lockDevice(context)
            val result = JSObject()
            result.put("success", success)
            call.resolve(result)
        }
    }

    /**
     * Parent's "Unlock now": releases the persistent parent lock above.
     * Dismissing an EXISTING PIN/pattern screen additionally needs Device
     * Owner (setKeyguardDisabled) — reported as keyguardDisabled so the UI
     * can be honest about it, but the release itself always succeeds.
     */
    @PluginMethod
    fun unlockDevice(call: PluginCall) {
        VoiceKidsPrefs.setParentLockActive(context, false)
        enforceExecutor.execute { runCatching { PolicyEnforcer.enforce(context.applicationContext) } }
        val keyguardDisabled = DpcActions.isDeviceAdmin(context) && DpcActions.unlockDevice(context)
        val result = JSObject()
        result.put("success", true)
        result.put("keyguardDisabled", keyguardDisabled)
        call.resolve(result)
    }

    /**
     * DESTRUCTIVE. Only call after explicit parent confirmation server-side
     * (the pc_device_commands row for factory_reset should require a second
     * confirmation step before being marked pending).
     */
    @PluginMethod
    fun wipeDevice(call: PluginCall) {
        runDeviceAdminAction(call) {
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

    // ── Native policy engine bridge ─────────────────────────────────────
    // PolicyEnforcer (see PolicyEnforcer.kt) is THE enforcement engine —
    // the JS layer no longer duplicates its decisions. These two methods let
    // the WebView (a) ask for an immediate pass when it just processed a
    // command such as grant_bonus_time, instead of waiting up to one
    // POLICY_ENFORCE_INTERVAL_MS tick, and (b) read the resulting state so
    // the child-facing UI can show the matching "Time's up" / "Not now" /
    // "Screen time paused" screen with the real numbers.

    private val enforceExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()

    @PluginMethod
    fun enforceNow(call: PluginCall) {
        val appContext = context.applicationContext
        enforceExecutor.execute {
            try {
                PolicyEnforcer.invalidateCache()
                PolicyEnforcer.enforce(appContext)
            } catch (e: Exception) {
                android.util.Log.w("VoiceKidsDpc", "enforceNow failed: ${e.message}")
            }
        }
        call.resolve(successResult())
    }

    @PluginMethod
    fun getEnforcementSnapshot(call: PluginCall) {
        val result = JSObject()
        val reason = VoiceKidsPrefs.lockReason(context)
        result.put("locked", reason.isNotEmpty())
        result.put("lockReason", if (reason.isEmpty()) JSObject.NULL else reason)
        result.put("lockLabel", VoiceKidsPrefs.lockLabel(context))
        result.put("blockAllActive", VoiceKidsPrefs.desiredBlockAllActive(context))
        result.put("allowListActive", VoiceKidsPrefs.desiredAllowListPackages(context) != null)
        result.put("bonusActive", VoiceKidsPrefs.isBonusActive(context))
        result.put("bonusExpiresAt", VoiceKidsPrefs.bonusExpiresAt(context))
        val used = VoiceKidsPrefs.screenTimeTodayMin(context)
        val limit = VoiceKidsPrefs.screenTimeLimitMin(context)
        result.put("screenTimeTodayMin", if (used < 0) JSObject.NULL else used)
        result.put("screenTimeLimitMin", if (limit < 0) JSObject.NULL else limit)
        result.put("blockedPackageCount", VoiceKidsPrefs.desiredBlockedPackages(context).size)
        result.put("websiteFilterActive", VoiceKidsPrefs.websiteFilterActive(context))
        result.put("isDeviceAdmin", dpm.isAdminActive(adminComponent))
        result.put("isDeviceOwner", dpm.isDeviceOwnerApp(context.packageName))
        result.put("accessibilityEnabled", AccessibilityStatus.isEnabled(context))
        result.put("usageAccess", UsageStatsHelper.hasUsageAccess(context))
        call.resolve(result)
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /** Gates the default (no-reset) enforcement actions on plain Device Admin, not Owner. */
    private fun runDeviceAdminAction(call: PluginCall, action: () -> Unit) {
        if (!dpm.isAdminActive(adminComponent)) {
            android.util.Log.e("VoiceKidsDpc", "NOT Device Admin!")
            val result = JSObject()
            result.put("success", false)
            result.put("reason", "not_device_admin")
            call.resolve(result)
            return
        }
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
