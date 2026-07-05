#!/usr/bin/env node
// Bulk-import devotees from the shared Google Sheet into Supabase.
// Creates an auth user (password = mobile number) + an approved 'devotee'
// profile for each row, assigned to VITE_DEFAULT_VOICE_ID.
//
// Usage:  node scripts/import-devotees.mjs
//
// Requires (.env or shell):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   VITE_DEFAULT_VOICE_ID

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1ejoRZYeCowsQWJJAhTaJulsD3JhyKo0k31HctebZ_KQ/gviz/tq?tqx=out:csv'

function loadEnv() {
  const file = join(ROOT, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VOICE_ID = process.env.VITE_DEFAULT_VOICE_ID

if (!SUPABASE_URL || !SERVICE_KEY || !VOICE_ID) {
  console.error('Missing VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or VITE_DEFAULT_VOICE_ID.')
  process.exit(1)
}

// --- Minimal CSV parser (handles quoted fields) ---
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

console.log('Fetching sheet...')
const csv = await (await fetch(SHEET_CSV)).text()
const rows = parseCsv(csv).slice(1) // drop header

let created = 0
let updated = 0
let skipped = 0

for (const cols of rows) {
  const name = (cols[1] || '').trim()
  const email = (cols[2] || '').trim().toLowerCase()
  const phone = (cols[3] || '').replace(/\D/g, '')

  if (!email) { skipped++; continue }
  const password = phone && phone.length >= 6 ? phone : 'HareKrsna108'

  // Create auth user
  const { data: c, error: cErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { spiritual_name: name || 'New Devotee' },
  })

  let userId = c?.user?.id ?? null
  if (cErr) {
    // Already exists — find them
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === email)
    if (!existing) { console.warn(`  ! ${email}: ${cErr.message}`); skipped++; continue }
    userId = existing.id
    updated++
  } else {
    created++
  }

  const { error: upErr } = await supabase
    .from('profiles')
    .update({
      email,
      legal_name: name || null,
      spiritual_name: name || 'New Devotee',
      phone: phone || null,
      role: 'devotee',
      is_approved: true,
      voice_id: VOICE_ID,
      is_active: true,
    })
    .eq('id', userId)

  if (upErr) console.warn(`  ! profile ${email}: ${upErr.message}`)
  else console.log(`  ✓ ${name} <${email}> (pw: ${password})`)
}

console.log(`\nDone. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`)
