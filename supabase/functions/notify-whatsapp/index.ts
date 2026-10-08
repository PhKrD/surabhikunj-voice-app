// Supabase Edge Function: notify-whatsapp
// Sends a WhatsApp message via a provider (Twilio implemented; WATI stub).
//
// Deploy:   supabase functions deploy notify-whatsapp
// Secrets:  supabase secrets set WHATSAPP_PROVIDER=twilio \
//             TWILIO_ACCOUNT_SID=ACxxxx TWILIO_AUTH_TOKEN=xxxx \
//             TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
// Invoke:   await supabase.functions.invoke('notify-whatsapp', { body: { to, message } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ambient declaration so editors using Node/DOM typings don't flag the Deno
// global. At runtime, Supabase Edge Functions provide `Deno` natively.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

interface Payload {
  to?: string
  message?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sendViaTwilio(to: string, message: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM') // e.g. "whatsapp:+14155238886"
  if (!sid || !token || !from) {
    throw new Error('Missing Twilio secrets (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)')
  }

  const body = new URLSearchParams({
    To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    From: from,
    Body: message,
  })

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || 'Twilio request failed')
  return data
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Every message is billed to the organisation's provider account, so only
  // signed-in members allowed to broadcast may send. (verify_jwt alone also
  // accepts the public anon key, which anyone can read from the app.)
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData } = await caller.auth.getUser()
  if (!userData?.user) return json({ error: 'Unauthorized' }, 401)
  const { data: permitted } = await caller.rpc('has_permission', { p_key: 'announcements.manage' })
  if (!permitted) return json({ error: 'Forbidden' }, 403)

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { to, message } = payload
  if (!to || !message) return json({ error: 'Both "to" and "message" are required' }, 400)

  try {
    const provider = (Deno.env.get('WHATSAPP_PROVIDER') || 'twilio').toLowerCase()
    if (provider === 'twilio') {
      const result = await sendViaTwilio(to, message)
      return json({ ok: true, provider, id: result?.sid ?? null })
    }
    return json({ error: `Unsupported WHATSAPP_PROVIDER: ${provider}` }, 400)
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
})
