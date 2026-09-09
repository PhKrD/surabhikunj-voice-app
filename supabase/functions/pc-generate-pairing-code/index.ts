// Supabase Edge Function: pc-generate-pairing-code
// Parent-authenticated. Creates (or reuses) a pc_devices row for a child,
// creates a device-only auth.users row with a random never-exposed
// password, and issues a short-lived hashed pairing code the child app
// exchanges for a real session via pc-redeem-pairing-code.
//
// Deploy:  supabase functions deploy pc-generate-pairing-code
// Invoke:  supabase.functions.invoke('pc-generate-pairing-code', { body: { child_id, device_name } })

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

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/I/1 ambiguity
const CODE_LENGTH = 6
const CODE_TTL_MIN = 10

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // --- Authenticate the caller (must be the child's parent) ---
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)

  let payload: { child_id?: string; device_name?: string; device_id?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const childId = payload.child_id
  const deviceName = (payload.device_name ?? 'New device').trim()
  // Optional: re-pair a specific existing device instead of reusing/creating.
  const requestedDeviceId = payload.device_id
  if (!childId) return json({ error: 'child_id is required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // --- Verify caller is the parent of this child ---
  const { data: child, error: childErr } = await admin
    .from('pc_children')
    .select('id, org_id, parent_id, linked_profile_id')
    .eq('id', childId)
    .single()

  if (childErr || !child) return json({ error: 'Child not found' }, 404)
  if (child.parent_id !== userData.user.id) return json({ error: 'Not authorized for this child' }, 403)

  // --- Resolve the linked org member (if any), verifying same-org ---
  // See supabase/68_child_org_link_and_tamper.sql. When set, pairing signs
  // the device in AS this real member's own account instead of minting a
  // throwaway device-only one, so org features (Sadhana, cleanliness, etc.)
  // work on the same device that is under parental-control supervision.
  let linkedAuthUserId: string | null = null
  if (child.linked_profile_id) {
    const { data: linkedProfile } = await admin
      .from('profiles')
      .select('id, org_id')
      .eq('id', child.linked_profile_id)
      .maybeSingle()
    if (linkedProfile && linkedProfile.org_id === child.org_id) {
      linkedAuthUserId = linkedProfile.id
    }
    // Silently ignore an invalid/cross-org link rather than failing pairing
    // entirely — falls back to the device-only throwaway account below.
  }

  // --- Reuse an existing device (re-pair) or create a new one ---
  // Reusing keeps the same device_id + auth user, so command history, rules,
  // location and usage data survive a re-pair (e.g. after the child app is
  // reinstalled / storage cleared). Only create a brand-new device when the
  // child has none yet. This prevents piling up orphaned duplicate devices
  // every time "Generate code" is tapped.
  let deviceId: string | undefined
  let deviceQuery = admin
    .from('pc_devices')
    .select('id, auth_user_id')
    .eq('child_id', childId)

  if (requestedDeviceId) deviceQuery = deviceQuery.eq('id', requestedDeviceId)

  const { data: existing } = await deviceQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id && existing.auth_user_id) {
    // Re-pair the existing device.
    deviceId = existing.id
    const updates: Record<string, unknown> = { device_name: deviceName, is_active: true, device_owner_mode: 'none' }
    // If the child was linked to (or re-linked to a different) org member
    // since this device was first created, adopt that identity now rather
    // than leaving the device stuck on a stale/throwaway auth user — the
    // child's next pairing-code redemption then signs in as the right
    // account. Never downgrades an already-linked device back to a
    // throwaway account (linkedAuthUserId is only ever a real profile id).
    if (linkedAuthUserId && linkedAuthUserId !== existing.auth_user_id) {
      updates.auth_user_id = linkedAuthUserId
    }
    await admin.from('pc_devices').update(updates).eq('id', deviceId)
    // Invalidate any still-valid unused codes for this device.
    await admin
      .from('pc_pairing_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('device_id', deviceId)
      .is('used_at', null)
  } else {
    // No existing device. If this child is linked to a real org member,
    // sign the device in as THAT member's own account (no throwaway auth
    // user needed — see supabase/68_child_org_link_and_tamper.sql). Only
    // create a device-only account when there's no link.
    let deviceAuthUserId = linkedAuthUserId
    if (!deviceAuthUserId) {
      const deviceUuid = crypto.randomUUID()
      const deviceEmail = `device-${deviceUuid}@voice.kids.internal`
      const devicePassword = randomPassword()

      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email: deviceEmail,
        password: devicePassword,
        email_confirm: true,
        user_metadata: { role: 'pc_device', child_id: childId },
      })
      if (authErr || !authUser?.user) {
        return json({ error: `Could not create device account: ${authErr?.message}` }, 500)
      }
      deviceAuthUserId = authUser.user.id
    }

    const { data: device, error: deviceErr } = await admin
      .from('pc_devices')
      .insert({
        child_id: childId,
        org_id: child.org_id,
        device_name: deviceName,
        auth_user_id: deviceAuthUserId,
        device_owner_mode: 'none',
        is_active: true,
      })
      .select('id')
      .single()

    if (deviceErr || !device) return json({ error: `Could not create device: ${deviceErr?.message}` }, 500)
    deviceId = device.id
  }

  // --- Generate the pairing code ---
  const code = generateCode()
  const codeHash = await sha256Hex(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString()

  const { error: codeErr } = await admin.from('pc_pairing_codes').insert({
    device_id: deviceId,
    code_hash: codeHash,
    issued_by: userData.user.id,
    expires_at: expiresAt,
  })
  if (codeErr) return json({ error: `Could not create pairing code: ${codeErr.message}` }, 500)

  return json({
    ok: true,
    device_id: deviceId,
    pairing_code: code,
    expires_at: expiresAt,
  })
})
