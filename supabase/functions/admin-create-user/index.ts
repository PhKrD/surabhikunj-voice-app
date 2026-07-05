// Supabase Edge Function: admin-create-user
// Creates an auth user + approved profile for a devotee. Admin-only.
// The initial password is the devotee's mobile number (they change it later).
//
// Deploy:  supabase functions deploy admin-create-user
// Invoke:  supabase.functions.invoke('admin-create-user', { body: {...} })
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided
// automatically by the Edge runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

const ADMIN_ROLES = ['admin', 'vmc', 'oc']

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

interface NewMember {
  email?: string
  legal_name?: string
  spiritual_name?: string
  phone?: string
  role?: string
  password?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // --- Authenticate the caller and confirm they are an admin ---
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, voice_id')
    .eq('id', userData.user.id)
    .single()

  if (!callerProfile || !ADMIN_ROLES.includes(callerProfile.role)) {
    return json({ error: 'Admins only' }, 403)
  }

  let payload: NewMember
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = (payload.email ?? '').trim().toLowerCase()
  const phone = (payload.phone ?? '').replace(/\D/g, '')
  const role = payload.role ?? 'devotee'
  const legalName = (payload.legal_name ?? '').trim()
  const spiritualName = (payload.spiritual_name ?? '').trim() || legalName || 'New Devotee'
  const password = (payload.password ?? '').trim() || phone || 'HareKrsna108'

  if (!email) return json({ error: 'Email is required' }, 400)
  if (password.length < 6) return json({ error: 'Password/mobile must be at least 6 chars' }, 400)

  // --- Create (or find existing) auth user ---
  let userId: string | null = null
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { spiritual_name: spiritualName },
  })

  if (created.error) {
    // Likely already exists — look them up so we can (re)assign the profile.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = list?.users?.find((u: { id: string; email?: string }) => u.email?.toLowerCase() === email)
    if (!existing) return json({ error: created.error.message }, 400)
    userId = existing.id
  } else {
    userId = created.data.user?.id ?? null
  }

  if (!userId) return json({ error: 'Could not resolve created user' }, 500)

  // --- Upsert the profile (handle_new_user may have created a stub row) ---
  const { error: upErr } = await admin
    .from('profiles')
    .update({
      email,
      legal_name: legalName || null,
      spiritual_name: spiritualName,
      phone: phone || null,
      role,
      is_approved: true,
      voice_id: callerProfile.voice_id,
      is_active: true,
    })
    .eq('id', userId)

  if (upErr) return json({ error: upErr.message }, 400)

  return json({ ok: true, id: userId, email, role })
})
