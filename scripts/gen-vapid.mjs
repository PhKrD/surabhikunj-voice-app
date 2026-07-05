#!/usr/bin/env node
// Generates a VAPID (Web Push) key pair using Node's built-in crypto.
// No external dependencies.
//
// Usage:  node scripts/gen-vapid.mjs
//
// Then set the printed values:
//   - VAPID_PUBLIC_KEY  -> also put in the app as VITE_VAPID_PUBLIC_KEY (.env)
//   - VAPID_PRIVATE_KEY -> Supabase secret (send-push function)
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com

import { generateKeyPairSync, createPublicKey } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

// Public key: uncompressed point (0x04 || X || Y), 65 bytes, base64url.
const pubDer = createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
// The last 65 bytes of the SPKI DER are the raw uncompressed point.
const rawPub = pubDer.subarray(pubDer.length - 65)

// Private key: the raw 32-byte scalar `d`, base64url.
const privJwk = privateKey.export({ format: 'jwk' })

const b64url = (buf) => Buffer.from(buf).toString('base64url')

const VAPID_PUBLIC_KEY = b64url(rawPub)
const VAPID_PRIVATE_KEY = privJwk.d // jwk `d` is already base64url

console.log('\nVAPID keys generated:\n')
console.log('VAPID_PUBLIC_KEY =', VAPID_PUBLIC_KEY)
console.log('VAPID_PRIVATE_KEY =', VAPID_PRIVATE_KEY)
console.log('\nApp (.env):')
console.log(`VITE_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}`)
console.log('\nSupabase secrets:')
console.log(
  `supabase secrets set VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY} VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY} VAPID_SUBJECT=mailto:admin@surabhikunj.org`
)
console.log('')
