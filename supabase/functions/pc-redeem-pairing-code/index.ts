// Supabase Edge Function: pc-redeem-pairing-code
// PUBLIC (no auth header required — the code itself is the credential).
// Child app calls this with { pairing_code } to exchange it for a real
// Supabase session for the device auth user, without ever handling a
// password. Uses generateLink('magiclink') + verifyOtp so the service
// role never has to expose the device account's password.
//
// Deploy:  supabase functions deploy pc-redeem-pairing-code --no-verify-jwt
// Invoke:  supabase.functions.invoke('pc-redeem-pairing-code', { body: { pairing_code } })

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

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let payload: { pairing_code?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const rawCode = (payload.pairing_code ?? '').trim().toUpperCase()
  if (!rawCode) return json({ error: 'pairing_code is required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const codeHash = await sha256Hex(rawCode)

  // --- Atomically claim the pairing code ---
  // A single UPDATE ... WHERE used_at IS NULL ... RETURNING is the guard
  // against two concurrent redeem requests racing the same still-valid
  // code (a check-then-update with separate round-trips would let both
  // pass the SELECT before either UPDATE lands). Whichever request's
  // UPDATE actually matches a row wins; the loser gets 0 rows back and is
  // rejected below, even though the code was technically valid at the
  // moment it read it.
  const { data: claimed, error: claimErr } = await admin
    .from('pc_pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .select('id, device_id, expires_at')

  if (claimErr) return json({ error: 'Could not redeem pairing code' }, 500)
  const pairing = claimed?.[0]
  if (!pairing) return json({ error: 'Invalid or already-used pairing code' }, 404)

  if (new Date(pairing.expires_at) < new Date()) {
    // Expired codes are still marked used above (correct — they should
    // never be redeemable again), but we must not proceed with enrollment.
    return json({ error: 'Pairing code has expired. Ask your parent to generate a new one.' }, 410)
  }

  // --- Load the device + child ---
  const { data: device, error: deviceErr } = await admin
    .from('pc_devices')
    .select('id, org_id, child_id, auth_user_id, pc_children(display_name)')
    .eq('id', pairing.device_id)
    .single()

  if (deviceErr || !device?.auth_user_id) return json({ error: 'Device not found' }, 404)

  // --- Mint a real session for the device auth user (no password ever exposed) ---
  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(device.auth_user_id)
  if (userErr || !userRes?.user?.email) return json({ error: 'Device account not found' }, 500)

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userRes.user.email,
  })
  if (linkErr || !linkData) return json({ error: `Could not mint session: ${linkErr?.message}` }, 500)

  const hashedToken = linkData.properties?.hashed_token
  if (!hashedToken) return json({ error: 'Could not generate verification token' }, 500)

  const anon = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  })
  if (verifyErr || !session?.session) return json({ error: `Could not verify session: ${verifyErr?.message}` }, 500)

  // --- Mark the device enrolled (the code was already atomically claimed above) ---
  await admin
    .from('pc_devices')
    .update({ enrolled_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
    .eq('id', device.id)

  // --- Notify the parent ---
  await admin.from('pc_alerts').insert({
    child_id: device.child_id,
    device_id: device.id,
    alert_type: 'device_enrolled',
    severity: 'info',
    title: 'Device enrolled',
    body: 'A new device just finished pairing.',
  })

  return json({
    ok: true,
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    device_id: device.id,
    child_id: device.child_id,
    org_id: device.org_id,
    // @ts-ignore — nested select typing
    child_name: device.pc_children?.display_name ?? '',
  })
})
