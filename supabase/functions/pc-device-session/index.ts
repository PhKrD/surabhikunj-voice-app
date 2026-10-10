// pc-device-session
//
// Mints a SECOND, independent Supabase session for a paired child device's
// native background layer (VoiceKidsMonitorService & co).
//
// Why: at pairing, the WebView and the native layer were handed the SAME
// refresh token. Supabase rotates refresh tokens on every refresh and treats
// a reused (already-rotated) token as theft, revoking the whole session. So
// whichever side refreshed second killed both — after which the phone
// silently stopped receiving its parent's changes. With its own session the
// native layer refreshes its own token chain and never collides.
//
// Security:
//   - The caller must present a valid JWT; the session minted is for THAT
//     SAME user only (never another account).
//   - The caller must own an ACTIVE pc_devices row (auth_user_id = caller)
//     and name it; anyone else gets 403.
//   - Nothing about the caller's identity is taken from the request body.
//
// POST { device_id }  (Authorization: Bearer <caller access token>)
// → { access_token, refresh_token }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Unauthorized' }, 401)

  let payload: { device_id?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const deviceId = (payload.device_id ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return json({ error: 'device_id is required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt)
  if (callerErr || !caller?.user?.id || !caller.user.email) return json({ error: 'Unauthorized' }, 401)

  const { data: device, error: deviceErr } = await admin
    .from('pc_devices')
    .select('id, auth_user_id, is_active')
    .eq('id', deviceId)
    .maybeSingle()
  if (deviceErr) return json({ error: 'Could not check device' }, 500)
  if (!device || device.auth_user_id !== caller.user.id || device.is_active === false) {
    return json({ error: 'Forbidden' }, 403)
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: caller.user.email,
  })
  const hashedToken = linkData?.properties?.hashed_token
  if (linkErr || !hashedToken) return json({ error: 'Could not mint session' }, 500)

  const anon = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  })
  if (verifyErr || !session?.session) return json({ error: 'Could not verify session' }, 500)

  return json({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  })
})
