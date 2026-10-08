import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const admin = createClient(supabaseUrl, serviceKey)
let anon
const results = []

async function check(name, fn) {
  try {
    const { data, error } = await fn()
    if (error) {
      results.push({ name, ok: false, error: error.message, details: error.details, hint: error.hint })
    } else {
      results.push({ name, ok: true, count: Array.isArray(data) ? data.length : (data ? 1 : 0) })
    }
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
  }
}

async function main() {
  const email = `test+${Date.now()}@example.com`
  const password = 'password123'
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createErr) { console.error('createUser failed:', createErr.message); return }
  const uid = created.user.id

  anon = createClient(supabaseUrl, anonKey)
  const { error: signInErr } = await anon.auth.signInWithPassword({ email, password })
  if (signInErr) { console.error('signIn failed:', signInErr.message); return }

  const { data: orgData, error: orgErr } = await anon.rpc('create_organization', { p_name: 'Smoke Test Org ' + Date.now() })
  if (orgErr) { console.error('create_organization failed:', JSON.stringify(orgErr)); return }
  const orgId = orgData.org_id
  console.log('Org created:', orgId)

  await anon.auth.refreshSession()

  const todayISO = new Date().toISOString().split('T')[0]
  const nowISO = new Date().toISOString()

  // ---- orgStore._load() ----
  await check('my_organizations', () => anon.rpc('my_organizations'))
  await check('my_navigation', () => anon.rpc('my_navigation'))
  await check('my_permissions', () => anon.rpc('my_permissions'))
  await check('organizations select (orgStore._load)', () =>
    anon.from('organizations').select('id, name, slug, logo_url, status, timezone, locale, join_code, organization_settings(branding, terminology, features)').eq('id', orgId).maybeSingle())

  // ---- authStore.fetchProfile ----
  await check('profiles select * (authStore)', () => anon.from('profiles').select('*').eq('id', uid).single())

  // ---- Dashboard ----
  await check('Dashboard: tracker_entries today', () =>
    anon.from('tracker_entries').select('id, score, tracker_definitions(id, name, color)').eq('user_id', uid).eq('org_id', orgId).eq('period_date', todayISO))
  await check('Dashboard: task_assignments', () =>
    anon.from('task_assignments').select('id, task_time, task_templates(name)').eq('user_id', uid).eq('task_date', todayISO).order('task_time'))
  await check('Dashboard: task_logs', () =>
    anon.from('task_logs').select('assignment_id, status').eq('user_id', uid).eq('log_date', todayISO))
  await check('Dashboard: resource_plans', () =>
    anon.from('resource_plans').select('id, resource_types(name, icon, color), resource_plan_items(name, quantity, sort_order)').eq('org_id', orgId).eq('plan_date', todayISO))
  await check('Dashboard: events', () =>
    anon.from('events').select('id, title, start_datetime, venue, event_type, is_mandatory').eq('org_id', orgId).eq('is_active', true).gte('start_datetime', nowISO).order('start_datetime', { ascending: true }).limit(4))
  await check('Dashboard: recent tracker_entries', () =>
    anon.from('tracker_entries').select('id, period_date, score, tracker_definitions(name, color)').eq('user_id', uid).eq('org_id', orgId).order('period_date', { ascending: false }).limit(5))
  await check('Dashboard: announcements', () =>
    anon.from('announcements').select('id, title, body, is_pinned, created_at').eq('org_id', orgId).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(2))
  await check('Dashboard: rpc my_mentor', () => anon.rpc('my_mentor'))

  // ---- AnnouncementsPage ----
  await check('Announcements: select with author embed', () =>
    anon.from('announcements').select('id, title, body, is_pinned, created_at, created_by, author:created_by(spiritual_name, avatar_url)').eq('org_id', orgId).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50))

  // ---- DepartmentsPage ----
  await check('Departments: select with incharge embeds', () =>
    anon.from('departments').select('*, incharge:incharge_id(spiritual_name, avatar_url), sub_incharge:sub_incharge_id(spiritual_name, avatar_url), department_members(count)').eq('org_id', orgId).eq('is_active', true).order('name'))

  // ---- EventsPage ----
  await check('Events: select *', () =>
    anon.from('events').select('*').eq('org_id', orgId).eq('is_active', true).gte('start_datetime', new Date(Date.now() - 86400000).toISOString()).order('start_datetime', { ascending: true }).limit(30))

  // ---- HierarchyPage ----
  await check('Hierarchy: org_positions with profile embed', () =>
    anon.from('org_positions').select('*, profile:profile_id(spiritual_name, avatar_url, role)').eq('org_id', orgId).order('sort_order'))

  // ---- NotificationsPage ----
  await check('Notifications: select *', () =>
    anon.from('notifications').select('*').eq('profile_id', uid).order('created_at', { ascending: false }).limit(50))

  // ---- ResidentsPage ----
  await check('Residents: profiles select', () =>
    anon.from('profiles').select('id, spiritual_name, legal_name, role, avatar_url, room_number, phone, initiated, is_active').eq('org_id', orgId).order('spiritual_name', { ascending: true }))
  await check('Residents: departments select', () =>
    anon.from('departments').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }))
  await check('Residents: department_members with embed', () =>
    anon.from('department_members').select('profile_id, department:department_id(id, name)'))

  // ---- TrackersPage ----
  await check('Trackers: tracker_definitions list', () =>
    anon.from('tracker_definitions').select('id, name, description, icon, color, cadence, has_scoring, is_active').eq('is_active', true).order('sort_order'))

  // ---- TasksPage ----
  await check('Tasks: task_assignments nested embed', () =>
    anon.from('task_assignments').select('id, task_date, task_time, notes, task_templates(name, description, task_categories(name))').eq('user_id', uid).eq('task_date', todayISO))

  // ---- ResourcesPage ----
  await check('Resources: resource_types', () =>
    anon.from('resource_types').select('id, name, icon, color, slots').eq('is_active', true))
  await check('Resources: resource_plans with items', () =>
    anon.from('resource_plans').select('id, resource_type_id, slot, title, notes, is_special, resource_plan_items(id, name, quantity, sort_order)').eq('plan_date', todayISO))

  // ---- MentorshipPage ----
  await check('Mentorship: rpc my_mentees', () => anon.rpc('my_mentees'))
  await check('Mentorship: rpc my_mentor', () => anon.rpc('my_mentor'))

  // ---- ReportsPage ----
  await check('Reports: tracker_definitions by org', () =>
    anon.from('tracker_definitions').select('id, name, color, has_scoring').eq('org_id', orgId))
  await check('Reports: rpc my_tracker_entries', () => anon.rpc('my_tracker_entries', { p_tracker_id: '00000000-0000-0000-0000-000000000000', p_limit: 30 }))
  await check('Reports: task_assignments range', () =>
    anon.from('task_assignments').select('id, task_date').eq('user_id', uid).gte('task_date', todayISO).lte('task_date', todayISO))
  await check('Reports: task_logs range', () =>
    anon.from('task_logs').select('assignment_id, log_date, status').eq('user_id', uid).gte('log_date', todayISO).lte('log_date', todayISO))
  await check('Reports: org-wide profiles count', () =>
    anon.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true))
  await check('Reports: org-wide tracker_entries count', () =>
    anon.from('tracker_entries').select('user_id', { count: 'exact', head: false }).eq('org_id', orgId).gte('period_date', todayISO).lte('period_date', todayISO))
  await check('Reports: org-wide task_logs count', () =>
    anon.from('task_logs').select('status', { count: 'exact', head: false }).eq('org_id', orgId).gte('log_date', todayISO).lte('log_date', todayISO))

  // ---- SettingsPage ----
  await check('Settings: organization_modules with modules embed', () =>
    anon.from('organization_modules').select('module_key, enabled, label_override, icon_override, sort_order, modules(name, icon, description, is_core, category)').eq('org_id', orgId))
  await check('Settings: roles', () =>
    anon.from('roles').select('id, name, description, is_system').eq('org_id', orgId).order('name'))
  await check('Settings: role_permissions', async () => {
    const { data: rolesData } = await anon.from('roles').select('id').eq('org_id', orgId)
    return anon.from('role_permissions').select('role_id, permission_key').in('role_id', (rolesData ?? []).map((r) => r.id))
  })

  // ---- MembersPage ----
  await check('Members: roles by org', () =>
    anon.from('roles').select('id, name').eq('org_id', orgId).order('name'))
  await check('Members: rpc org_members', () => anon.rpc('org_members'))

  // ---- ResidentProfilePage ----
  await check('ResidentProfile: profiles by id', () =>
    anon.from('profiles').select('*').eq('id', uid).maybeSingle())
  await check('ResidentProfile: sadhana_weekly_reports', () =>
    anon.from('sadhana_weekly_reports').select('id, week_start, total_score').eq('profile_id', uid).order('week_start', { ascending: false }).limit(7))

  console.log('\n=== RESULTS ===')
  const failed = results.filter((r) => !r.ok)
  const passed = results.filter((r) => r.ok)
  console.log(`PASSED: ${passed.length}/${results.length}\n`)
  if (failed.length) {
    console.log('FAILURES:')
    for (const f of failed) {
      console.log(`\n[FAIL] ${f.name}`)
      console.log(`  error: ${f.error}`)
      if (f.details) console.log(`  details: ${JSON.stringify(f.details)}`)
      if (f.hint) console.log(`  hint: ${f.hint}`)
    }
  }

  await admin.auth.admin.deleteUser(uid)
}

main()
