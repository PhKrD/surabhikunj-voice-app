// Supabase Edge Function: send-push
// Delivers a notification to all of a profile's devices via:
//   - Web Push (VAPID)  -> PWA on iOS 16.4+, Android Chrome, desktop
//   - FCM HTTP v1       -> Android APK (native @capacitor/push-notifications)
//
// Called automatically by the `trg_notify_push` trigger (see 19_push_notifications.sql)
// with the service_role key, and can also be invoked directly.
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secrets:
//   supabase secrets set \
//     VAPID_PUBLIC_KEY=xxx VAPID_PRIVATE_KEY=xxx VAPID_SUBJECT=mailto:admin@surabhikunj.org \
//     FCM_PROJECT_ID=your-firebase-project \
//     FCM_SERVICE_ACCOUNT='{...service account json...}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---- FCM HTTP v1: mint an OAuth token from the service account (RS256 JWT) ----
function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

async function getFcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || 'FCM token error')
  return data.access_token
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: { profile_id?: string; title?: string; body?: string; type?: string; reference_id?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { profile_id, title, body, type, reference_id } = payload
  if (!profile_id || !title) return json({ error: 'profile_id and title required' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const notif = { title, body: body ?? '', type: type ?? 'general', reference_id: reference_id ?? null }
  const results = { web: 0, fcm: 0, errors: [] as string[] }

  // ---------- Web Push ----------
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('profile_id', profile_id)

    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(notif)
        )
        results.web++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 404/410 => subscription expired, remove it
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        } else {
          results.errors.push(`web:${(e as Error).message}`)
        }
      }
    }
  }

  // ---------- FCM (Android) ----------
  const fcmProject = Deno.env.get('FCM_PROJECT_ID')
  const fcmSaRaw = Deno.env.get('FCM_SERVICE_ACCOUNT')

  if (fcmProject && fcmSaRaw) {
    try {
      const sa = JSON.parse(fcmSaRaw)
      const token = await getFcmAccessToken(sa)
      const { data: devices } = await admin
        .from('device_tokens')
        .select('*')
        .eq('profile_id', profile_id)

      for (const d of devices ?? []) {
        try {
          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  token: d.token,
                  notification: { title: notif.title, body: notif.body },
                  data: { type: notif.type, reference_id: String(notif.reference_id ?? '') },
                  android: {
                    priority: 'high',
                    notification: { sound: 'default', channel_id: 'voice_default' },
                  },
                },
              }),
            }
          )
          if (res.ok) {
            results.fcm++
          } else {
            const err = await res.json()
            const code = err?.error?.status
            if (code === 'NOT_FOUND' || code === 'INVALID_ARGUMENT' || code === 'UNREGISTERED') {
              await admin.from('device_tokens').delete().eq('token', d.token)
            } else {
              results.errors.push(`fcm:${err?.error?.message ?? res.status}`)
            }
          }
        } catch (e) {
          results.errors.push(`fcm:${(e as Error).message}`)
        }
      }
    } catch (e) {
      results.errors.push(`fcm-setup:${(e as Error).message}`)
    }
  }

  return json({ ok: true, ...results })
})
