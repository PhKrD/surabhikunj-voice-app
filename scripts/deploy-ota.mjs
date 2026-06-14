#!/usr/bin/env node
// Free self-hosted OTA deploy: zip the Vite build and upload it to Supabase
// Storage, then publish a version.json manifest the app reads on launch.
//
// Usage:
//   npm run build
//   npm run deploy:ota            # auto-bumps patch version
//   npm run deploy:ota 1.4.0      # explicit version
//
// Requires these env vars (in .env or the shell):
//   VITE_SUPABASE_URL            your project URL
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (Settings > API). NEVER ship
//                                this in the app — it is only used here, locally.
// Optional:
//   OTA_BUCKET                   storage bucket name (default: app-bundles)

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()

// --- Minimal .env loader (so we don't add a dependency) -------------------
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
const BUCKET = process.env.OTA_BUCKET || 'app-bundles'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const distDir = join(ROOT, 'dist')
if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/index.html not found. Run "npm run build" first.')
  process.exit(1)
}

// --- Resolve version ------------------------------------------------------
const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
let version = process.argv[2]
if (!version) {
  const parts = (pkg.version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0)
  parts[2] += 1
  version = parts.join('.')
}
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Deploying OTA bundle v${version}...`)

// --- Zip the dist contents (index.html at the zip root) -------------------
const work = mkdtempSync(join(tmpdir(), 'ota-'))
const zipPath = join(work, `${version}.zip`)
execSync(`zip -r -q "${zipPath}" .`, { cwd: distDir })
const zipData = readFileSync(zipPath)

// --- Upload --------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// Ensure the bucket exists (public so the app can download without auth).
const { data: buckets } = await supabase.storage.listBuckets()
if (!buckets?.some((b) => b.name === BUCKET)) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error) {
    console.error('Could not create bucket:', error.message)
    process.exit(1)
  }
  console.log(`Created public bucket "${BUCKET}".`)
}

const objectPath = `bundles/${version}.zip`
const up = await supabase.storage
  .from(BUCKET)
  .upload(objectPath, zipData, { contentType: 'application/zip', upsert: true })
if (up.error) {
  console.error('Bundle upload failed:', up.error.message)
  process.exit(1)
}

const bundleUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${objectPath}`
const manifest = JSON.stringify({ version, url: bundleUrl }, null, 2)

const man = await supabase.storage
  .from(BUCKET)
  .upload('version.json', Buffer.from(manifest), {
    contentType: 'application/json',
    upsert: true,
    cacheControl: '0',
  })
if (man.error) {
  console.error('Manifest upload failed:', man.error.message)
  process.exit(1)
}

console.log(`\n✅ OTA v${version} published.`)
console.log(`   Bundle:   ${bundleUrl}`)
console.log(`   Manifest: ${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/version.json`)
console.log('\nUsers will receive it on their next app launch.')
