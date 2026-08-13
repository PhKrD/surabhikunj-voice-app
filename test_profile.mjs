import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const admin = createClient(supabaseUrl, serviceKey)

async function main() {
  const email = `test+${Date.now()}@example.com`
  const password = 'password123'
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createErr) { console.error('createUser failed:', createErr.message); return }

  const anon = createClient(supabaseUrl, anonKey)
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password })
  if (signInErr) { console.error('signIn failed:', signInErr.message); return }
  const uid = signIn.user.id
  console.log('uid', uid)

  const { data, error } = await anon.from('profiles').select('*, organizations(name)').eq('id', uid).single()
  if (error) {
    console.error('profiles select error:', JSON.stringify(error, null, 2))
  } else {
    console.log('profiles select ok:', data)
  }

  // also test create_organization + then reselect
  const { data: orgData, error: orgErr } = await anon.rpc('create_organization', { p_name: 'Bug Test Org ' + Date.now() })
  if (orgErr) console.error('create_organization error:', JSON.stringify(orgErr, null, 2))
  else console.log('create_organization ok:', orgData)

  const { data: myOrgs, error: myOrgsErr } = await anon.rpc('my_organizations')
  console.log('my_organizations:', myOrgs, myOrgsErr)

  const { data: myNav, error: myNavErr } = await anon.rpc('my_navigation')
  console.log('my_navigation:', myNav, myNavErr)

  const { data: myPerms, error: myPermsErr } = await anon.rpc('my_permissions')
  console.log('my_permissions:', myPerms, myPermsErr)

  await admin.auth.admin.deleteUser(uid)
}

main()
