import { supabase } from '@/lib/supabase'

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
        console.error('[push] save device token failed:', e)
      }
      onReg.then?.((h) => h.remove?.())
      resolve({ ok: true, channel: 'fcm' })
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] FCM registration error:', err)
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
    console.warn('[push] VITE_VAPID_PUBLIC_KEY not set — web push disabled')
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
    console.error('[push] save web subscription failed:', e)
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, channel: 'web' }
}

export async function registerPush(profileId) {
  if (!profileId) return { ok: false, reason: 'no_profile' }
  try {
    return isNative() ? await registerNative(profileId) : await registerWeb(profileId)
  } catch (e) {
    console.error('[push] registration failed:', e)
    return { ok: false, reason: 'error' }
  }
}

// Whether we can even ask (used to show an enable-notifications prompt in UI).
export function pushSupported() {
  if (isNative()) return true
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}
