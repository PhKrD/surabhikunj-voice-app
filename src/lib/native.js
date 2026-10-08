// Native integration, written so the SAME web bundle runs on every installed
// APK. OTA updates reach old APKs too, so a plugin that an older APK lacks
// must never be called unguarded — it would crash on "not implemented".
// hasPlugin() checks the running APK before every native call.
import { Capacitor } from '@capacitor/core'
import { logger } from '@/lib/logger'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform()

export function hasPlugin(name) {
  return isNative && Capacitor.isPluginAvailable(name)
}

// APKs released before the App plugin was added (versionCode <= 2) cannot
// report their version; knowing that they predate it is enough to tell them
// an update exists.
const LEGACY_NATIVE = { versionCode: 2, versionName: '1.1', legacy: true }

let nativeInfoPromise = null

/**
 * The installed APK's version. versionCode is the integer from
 * android/app/build.gradle that update gating compares against.
 * Returns { versionCode: null } on the web, where there is no APK.
 */
export function getNativeInfo() {
  if (!nativeInfoPromise) {
    nativeInfoPromise = (async () => {
      if (!isNative) return { versionCode: null, versionName: null, legacy: false }
      if (!hasPlugin('App')) return LEGACY_NATIVE
      try {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        return { versionCode: parseInt(info.build, 10) || null, versionName: info.version, legacy: false }
      } catch (e) {
        logger.warn('[native] getInfo failed', e)
        return LEGACY_NATIVE
      }
    })()
  }
  return nativeInfoPromise
}

const resumeListeners = new Set()

/** Called when the app returns to the foreground (and on reconnect). */
export function onAppResume(fn) {
  resumeListeners.add(fn)
  return () => resumeListeners.delete(fn)
}

function fireResume() {
  resumeListeners.forEach((fn) => {
    try {
      fn()
    } catch (e) {
      logger.warn('[native] resume listener failed', e)
    }
  })
}

let initialized = false

/**
 * One-time native setup. `onBack` receives each hardware back press.
 */
export async function initNative({ onBack } = {}) {
  if (initialized) return
  initialized = true

  // Reconnecting after being offline is treated like a resume: refresh data.
  window.addEventListener('online', fireResume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isNative) fireResume()
  })

  if (!isNative) return

  if (hasPlugin('App')) {
    const { App } = await import('@capacitor/app')
    const { supabase } = await import('@/lib/supabase')
    // Supabase's token refresh timer stops while Android suspends the app;
    // hand control to the app lifecycle as Supabase recommends for mobile.
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        supabase.auth.startAutoRefresh()
        fireResume()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    })
    App.addListener('backButton', () => onBack?.())
  }

  if (hasPlugin('Keyboard')) {
    const { Keyboard } = await import('@capacitor/keyboard')
    // Keep the field being typed into visible above the keyboard.
    Keyboard.addListener('keyboardDidShow', () => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
      }
    })
  }

  if (hasPlugin('PushNotifications')) {
    const { installNotificationTapHandler } = await import('@/lib/push')
    installNotificationTapHandler()
  }
}

/** Status bar icons follow the theme (dark icons on light backgrounds). */
export async function syncStatusBar(isDark) {
  if (!hasPlugin('StatusBar')) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: isDark ? '#14121c' : '#f6f5fa' })
  } catch {
    // Older Android versions ignore colour changes.
  }
}

/** Hides the native splash once the first real screen has rendered. */
export async function hideSplash() {
  if (!hasPlugin('SplashScreen')) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide({ fadeOutDuration: 200 })
  } catch {
    // Nothing to hide.
  }
}

/** Leaves the app (Android back on a top-level screen). */
export async function exitApp() {
  if (!hasPlugin('App')) return
  const { App } = await import('@capacitor/app')
  App.exitApp()
}

/** Opens a URL outside the app (APK download, external links). */
export function openExternal(url) {
  window.open(url, '_system')
}
