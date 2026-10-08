import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// Unified push-notification registration.
//   - Native (Capacitor / Android APK): FCM via @capacitor/push-notifications
//   - Web / PWA (iOS 16.4+ home screen, Android Chrome, desktop): Web Push (VAPID)
//
// Call registerPush(profileId) once the user is authenticated. Safe to call
// multiple times; it no-ops if already registered / unsupported.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function isNative() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Where a notification opens when it carries no explicit in-app URL
// (older notifications, or a push function not yet redeployed).
const ROUTE_BY_TYPE = [
  [/announce|broadcast/, '/announcements'],
  [/event/, '/events'],
  [/seva|service|task/, '/services'],
  [/clean/, '/cleanliness'],
  [/sadhana|tracker/, '/trackers'],
  [/mentor|counsel/, '/mentorship'],
  [/sos|alert|bonus|child|device|parental/, '/parental-control'],
]

export function routeForNotification({ url, type } = {}) {
  if (typeof url === 'string' && url.startsWith('/')) return url
  const t = String(type ?? '').toLowerCase()
  return ROUTE_BY_TYPE.find(([re]) => re.test(t))?.[1] ?? '/notifications'
}

let tapListenerInstalled = false

/**
 * Tapping a system notification opens the screen it is about (and marks it
 * read). Installed at app start — not only after sign-in — so a tap that
 * cold-starts the app is not lost.
 */
export async function installNotificationTapHandler() {
  if (!isNative() || tapListenerInstalled) return
  tapListenerInstalled = true
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const { navigateTo } = await import('@/lib/navigation')
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const data = notification?.data ?? {}
    navigateTo(routeForNotification(data))
    if (data.notification_id) {
      supabase.from('notifications').update({ is_read: true }).eq('id', data.notification_id).then(() => {}, () => {})
    }
  })
}

// ---------------- Native (FCM) ----------------
async function registerNative(profileId) {
  const { PushNotifications } = await import('@capacitor/push-notifications')

  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') return { ok: false, reason: 'denied' }

  // High-importance channel so alerts make a sound + heads-up banner (Android 8+).
  try {
    await PushNotifications.createChannel({
      id: 'voice_default',
      name: 'VOICE Alerts',
      description: 'Announcements, seva, events and reminders',
      importance: 5,
      sound: 'default',
      vibration: true,
      visibility: 1,
    })
  } catch {
    // createChannel is Android-only; ignore on other platforms.
  }

  return new Promise((resolve) => {
    const onReg = PushNotifications.addListener('registration', async (token) => {
      try {
        await supabase.from('device_tokens').upsert(
          {
            profile_id: profileId,
            token: token.value,
            platform: window.Capacitor?.getPlatform?.() || 'android',
          },
          { onConflict: 'token' }
        )
      } catch (e) {
        logger.warn('[push] save device token failed:', e)
      }
      onReg.then?.((h) => h.remove?.())
      resolve({ ok: true, channel: 'fcm' })
    })

    PushNotifications.addListener('registrationError', (err) => {
      logger.warn('[push] FCM registration error:', err)
      resolve({ ok: false, reason: 'registration_error' })
    })

    PushNotifications.register()
  })
}

// ---------------- Web Push (VAPID) ----------------
async function registerWeb(profileId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' }
  }
  if (!VAPID_PUBLIC_KEY) {
    logger.warn('[push] VITE_VAPID_PUBLIC_KEY not set — web push disabled')
    return { ok: false, reason: 'no_vapid_key' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  try {
    await supabase.from('push_subscriptions').upsert(
      {
        profile_id: profileId,
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' }
    )
  } catch (e) {
    logger.warn('[push] save web subscription failed:', e)
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, channel: 'web' }
}

export async function registerPush(profileId) {
  if (!profileId) return { ok: false, reason: 'no_profile' }
  try {
    return isNative() ? await registerNative(profileId) : await registerWeb(profileId)
  } catch (e) {
    logger.warn('[push] registration failed:', e)
    return { ok: false, reason: 'error' }
  }
}

// Whether we can even ask (used to show an enable-notifications prompt in UI).
export function pushSupported() {
  if (isNative()) return true
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}
