package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager

/**
 * Packages that must NEVER be kicked off screen, whatever the policy says.
 *
 * A hard-coded list (the previous approach) only knew AOSP/Pixel package
 * names. On Samsung, Xiaomi, Vivo, Oppo, Realme and OnePlus the launcher,
 * dialer and in-call screen have other names, so during bedtime or an
 * allow-list routine:
 *   - pressing Home opened the OEM launcher, which was "blocked", which sent
 *     the child Home again — a flicker loop every 1.5 seconds;
 *   - the OEM dialer was blocked, so EMERGENCY CALLS were impossible;
 *   - the keyboard window was blocked, so the child could not even type a
 *     "more time" request.
 *
 * This resolves the real packages on THIS device: every home launcher, every
 * app that handles dialling, the default/system dialer, enabled keyboards,
 * the permission controller and package installer — plus a static safety
 * floor. Cached for a few minutes; package installs are rare.
 */
object EssentialApps {
    private const val CACHE_MS = 5 * 60_000L

    // Floor that applies even if PackageManager queries fail.
    private val STATIC = setOf(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.providers.settings",
        // Telephony / emergency calling (AOSP, Google, Samsung).
        "com.android.server.telecom",
        "com.android.phone",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.android.incallui",
        "com.samsung.android.dialer",
        "com.samsung.android.incallui",
        "com.android.emergency",
        "com.google.android.apps.safetyhub",
        "com.android.cellbroadcastreceiver",
        "com.google.android.cellbroadcastreceiver",
        // Permission dialogs (needed to finish setup, even during a routine).
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        // Launchers we know of, in case HOME resolution is restricted.
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.sec.android.app.launcher",
        "com.miui.home",
        "com.mi.android.globallauncher",
        "com.bbk.launcher2",
        "com.oppo.launcher",
        "com.coloros.launcher",
        "com.oneplus.launcher",
        "net.oneplus.launcher",
    )

    @Volatile private var cached: Set<String>? = null
    @Volatile private var cachedLaunchers: Set<String> = emptySet()
    @Volatile private var cachedAt = 0L

    /** Home launchers + keyboards + system UI: being on these is not "screen time". */
    fun launchersAndKeyboards(context: Context): Set<String> {
        get(context)
        return cachedLaunchers
    }

    fun get(context: Context): Set<String> {
        val now = System.currentTimeMillis()
        cached?.let { if (now - cachedAt < CACHE_MS) return it }
        val out = HashSet<String>(STATIC)
        out.add(context.packageName)
        val launchers = hashSetOf("com.android.systemui")
        val pm = context.packageManager
        runCatching {
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
                .forEach { launchers.add(it.activityInfo.packageName) }
        }
        runCatching {
            context.getSystemService(InputMethodManager::class.java)
                ?.enabledInputMethodList?.forEach { launchers.add(it.packageName) }
        }
        out.addAll(launchers)
        runCatching {
            pm.queryIntentActivities(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")), 0)
                .forEach { out.add(it.activityInfo.packageName) }
        }
        runCatching {
            val telecom = context.getSystemService(TelecomManager::class.java)
            telecom?.defaultDialerPackage?.let(out::add)
            telecom?.systemDialerPackage?.let(out::add)
        }
        cachedLaunchers = launchers
        cached = out
        cachedAt = now
        return out
    }

    fun isEssential(context: Context, pkg: String): Boolean = get(context).contains(pkg)

    /** Forget the cache (e.g. after an app install/uninstall). */
    fun invalidate() {
        cached = null
    }
}
