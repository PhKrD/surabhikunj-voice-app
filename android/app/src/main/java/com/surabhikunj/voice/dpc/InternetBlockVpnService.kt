package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.IOException

/**
 * InternetBlockVpnService
 *
 * A minimal VPN that captures ALL device traffic and silently drops it, effectively
 * cutting off internet for every app — EXCEPT the VOICE Kids app itself, which is
 * exempted via addDisallowedApplication() so the background monitoring service can
 * still reach Supabase and receive the parent's resume_internet command.
 *
 * Usage (called from DpcActions):
 *   1. Device Owner calls dpm.setAlwaysOnVpnPackage(...) → grants VPN permission silently.
 *   2. InternetBlockVpnService.start(context)  → internet blocked for child.
 *   3. InternetBlockVpnService.stop(context)   → internet restored for child.
 *
 * IMPORTANT — no startForeground() call here:
 *   VpnService is special: the Android OS automatically promotes any service that
 *   has an active VPN interface (via Builder.establish()) to the foreground and
 *   shows the system VPN key notification.  Calling startForeground() ourselves
 *   would require declaring a foregroundServiceType in the manifest (and on
 *   API 34+ this causes a crash if the type isn't recognised for VPN).
 *   Removing that call is the correct, documented approach for VpnService.
 *
 * Works on Android 7.0+ (API 24+, where setAlwaysOnVpnPackage is available).
 */
class InternetBlockVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    @Volatile private var running = false

    companion object {
        private const val TAG = "VoiceKidsVPN"

        fun start(context: Context) {
            // Plain startService() — VpnService handles its own foreground state
            // once Builder.establish() succeeds; startForegroundService() is NOT
            // needed here and would require a foregroundServiceType on API 34+.
            context.startService(Intent(context, InternetBlockVpnService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, InternetBlockVpnService::class.java))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        if (running) return
        try {
            val vpnBuilder = Builder()
                .setSession("VOICE Kids – Internet Paused")
                // Tunnel address — any unused LAN address will do
                .addAddress("10.200.200.1", 32)
                // Route ALL IPv4 and IPv6 through this VPN (drop-everything tunnel)
                .addRoute("0.0.0.0", 0)
                .addRoute("::", 0)
                // Our own app bypasses the VPN so the monitoring service keeps
                // Supabase connectivity and can receive the resume_internet command.
                .addDisallowedApplication(packageName)

            vpnInterface = vpnBuilder.establish() ?: run {
                Log.e(TAG, "VPN establish() returned null — VPN permission not granted yet")
                stopSelf()
                return
            }

            running = true
            Log.i(TAG, "VPN started — internet blocked for all apps except $packageName")

            // Drain the VPN interface on a background thread.
            // Reading packets and discarding them == no forwarding == no internet for captured apps.
            val fd = vpnInterface!!.fileDescriptor
            Thread {
                val buf = ByteArray(32_767)
                val stream = FileInputStream(fd)
                try {
                    while (running) {
                        val n = stream.read(buf)
                        if (n < 0) break
                        // Intentionally discard — drop the packet
                    }
                } catch (e: IOException) {
                    // Normal when vpnInterface.close() is called from stopVpn()
                }
                Log.i(TAG, "VPN drain thread finished")
            }.apply { isDaemon = true; start() }

        } catch (e: Exception) {
            Log.e(TAG, "startVpn failed: ${e.message}")
            stopSelf()
        }
    }

    private fun stopVpn() {
        running = false
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null
        Log.i(TAG, "VPN stopped — internet restored")
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    /** Called by the OS when a higher-priority VPN takes over (e.g. user installs their own). */
    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
