// =====================================================================
// haptics.js — tactile feedback that degrades silently.
//
// On Android/iOS this uses @capacitor/haptics. In a browser it falls back
// to navigator.vibrate where available (Chrome on Android) and otherwise
// does nothing at all.
//
// Every function is fire-and-forget and never throws: haptics are a nice
// touch, not a feature worth breaking a tap over. The plugin is imported
// lazily and cached so it stays out of the initial bundle.
// =====================================================================
import { Capacitor } from '@capacitor/core'

let pluginPromise = null
function plugin() {
  if (!pluginPromise) pluginPromise = import('@capacitor/haptics')
  return pluginPromise
}

// Respect the OS "reduce motion" preference as a proxy for users who
// don't want extra sensory feedback.
function muted() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function webVibrate(pattern) {
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}

async function run(fn, webPattern) {
  if (muted()) return
  try {
    // The native half of the plugin only exists in a new enough APK; on an
    // older install fall back to the web vibrate path instead of throwing
    // on every single tap.
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics')) {
      const mod = await plugin()
      await fn(mod)
    } else {
      webVibrate(webPattern)
    }
  } catch { /* haptics are never critical */ }
}

/** Light tap — buttons, chips, toggles, tab switches. */
export function tap() {
  return run(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }), 8)
}

/** Medium tap — a value committed, a step completed. */
export function select() {
  return run(({ Haptics }) => Haptics.selectionChanged(), 12)
}

/** Heavier tap — destructive or significant actions. */
export function heavy() {
  return run(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Heavy }), 24)
}

export function success() {
  return run(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }), [12, 40, 12])
}

export function warning() {
  return run(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Warning }), [18, 60, 18])
}

export function error() {
  return run(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Error }), [24, 60, 24, 60, 24])
}

export default { tap, select, heavy, success, warning, error }
