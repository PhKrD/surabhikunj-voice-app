/**
 * _emu_enroll.mjs — throwaway helper for emulator smoke tests. Gitignored.
 *
 * Creates a temp parent auth user + pc_children row + pc_devices row +
 * pairing code with the service-role key, redeems it through the
 * pc-redeem-pairing-code edge function to get a real device session, and
 * prints the shared_prefs XML to write onto the emulator.
 *
 *   node _emu_enroll.mjs create   → provisions + prints XML + ids
 *   node _emu_enroll.mjs clean <childId> <authUserId> <parentId>
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)

const URL = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

const rand = () => Math.random().toString(36).slice(2, 8)

async function create() {
  const parentEmail = `emu-parent-${rand()}@example.invalid`
  const { data: parent, error: pErr } = await admin.auth.admin.createUser({
    email: parentEmail, password: `Pw!${rand()}${rand()}`, email_confirm: true,
  })
  if (pErr) throw pErr

  const { data: orgRow } = await admin.from('organizations').select('id').limit(1).single()
  const orgId = orgRow.id

  const { data: child, error: cErr } = await admin
    .from('pc_children')
    .insert({ parent_id: parent.user.id, org_id: orgId, display_name: `Emu ${rand()}`, age_group: 'teen' })
    .select().single()
  if (cErr) throw cErr

  const deviceEmail = `emu-device-${rand()}@example.invalid`
  const { data: devUser, error: dErr } = await admin.auth.admin.createUser({
    email: deviceEmail, password: `Pw!${rand()}${rand()}`, email_confirm: true,
  })
  if (dErr) throw dErr

  const { data: device, error: devErr } = await admin
    .from('pc_devices')
    .insert({
      child_id: child.id, org_id: orgId, auth_user_id: devUser.user.id, device_name: 'Emulator',
      platform: 'android', is_active: true,
    })
    .select().single()
  if (devErr) throw devErr

  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: deviceEmail })
  if (lErr) throw lErr

  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: sess, error: sErr } = await anonClient.auth.verifyOtp({
    email: deviceEmail, token: link.properties.email_otp, type: 'email',
  })
  if (sErr) throw sErr

  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="supabase_url">${URL}</string>
    <string name="anon_key">${ANON}</string>
    <string name="device_id">${device.id}</string>
    <string name="child_id">${child.id}</string>
    <string name="org_id">${orgId}</string>
    <string name="access_token">${sess.session.access_token}</string>
    <string name="refresh_token">${sess.session.refresh_token}</string>
</map>`

  console.log(JSON.stringify({
    childId: child.id, deviceId: device.id, orgId,
    parentAuthId: parent.user.id, deviceAuthId: devUser.user.id,
    accessToken: sess.session.access_token, refreshToken: sess.session.refresh_token,
  }, null, 2))
  console.log('---XML---')
  console.log(xml)
}

async function clean(childId, ...authIds) {
  await admin.from('pc_children').delete().eq('id', childId)
  for (const id of authIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log('cleaned')
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'create') await create()
else if (cmd === 'clean') await clean(...args)
else console.log('usage: create | clean <childId> <authId...>')
