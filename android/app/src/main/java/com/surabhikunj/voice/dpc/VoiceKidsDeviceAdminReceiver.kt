package com.surabhikunj.voice.dpc

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserManager
import android.util.Log

/**
 * VoiceKidsDeviceAdminReceiver
 *
 * Declared in AndroidManifest.xml so the OS can hand Device Admin / Device
 * Owner rights to this app. Two enrollment paths lead here:
 *
 *   1. QR provisioning at factory reset (recommended) → onProfileProvisioningComplete
 *      fires once, with FULL Device Owner rights (all DPC APIs unlocked).
 *   2. Manual "Activate device admin" from Settings (fallback, limited) →
 *      onEnabled fires with Device Administrator rights only (legacy,
 *      much smaller API surface — no setPackagesSuspended, no lock task,
 *      no wipeData without extra confirmation).
 *
 * After provisioning completes we immediately lock down anti-tamper
 * restrictions (DISALLOW_UNINSTALL_APPS etc.) and launch the app so the
 * enrollment screen (EnrollmentPage.jsx) can pair with the parent account.
 */
class VoiceKidsDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device Admin enabled (legacy mode — limited enforcement)")
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Log.i(TAG, "Device Owner provisioning complete")

        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, VoiceKidsDeviceAdminReceiver::class.java)

        if (dpm.isDeviceOwnerApp(context.packageName)) {
            applyAntiTamperRestrictions(dpm, admin)
        }

        // Launch the app so the child/parent can complete pairing
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch?.let { context.startActivity(it) }
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "Device Admin disabled — enforcement stopped. This should not happen in Device Owner mode.")
    }

    override fun onLockTaskModeEntering(context: Context, intent: Intent, pkg: String) {
        super.onLockTaskModeEntering(context, intent, pkg)
        Log.i(TAG, "Entered kiosk/lock-task mode for package: $pkg")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        super.onLockTaskModeExiting(context, intent)
        Log.i(TAG, "Exited kiosk/lock-task mode")
    }

    /**
     * Prevents the child from disabling enforcement by uninstalling the app,
     * booting into safe mode, or factory resetting the device. These are
     * only enforceable in Device Owner mode.
     */
    private fun applyAntiTamperRestrictions(dpm: DevicePolicyManager, admin: ComponentName) {
        try {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
            dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
            dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
            dpm.setUninstallBlocked(admin, admin.packageName, true)
            Log.i(TAG, "Anti-tamper restrictions applied")
        } catch (e: SecurityException) {
            Log.e(TAG, "Failed to apply anti-tamper restrictions: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "VoiceKidsDPC"
    }
}
