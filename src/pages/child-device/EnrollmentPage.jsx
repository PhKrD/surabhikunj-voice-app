/**
 * EnrollmentPage.jsx
 * Shown when the device is not yet paired with a child profile.
 *
 * Flow:
 *   1. Parent opens parent VOICE app → Parental Control → Add Device →
 *      calls edge function "pc-generate-pairing-code", gets back a 6-char
 *      code (10-minute TTL) and shows it to the child (or a QR of it).
 *   2. Child enters the code here → this screen calls edge function
 *      "pc-redeem-pairing-code", which mints a real Supabase session for
 *      the device's auth user WITHOUT ever transmitting a password
 *      (magic-link token exchange happens server-side).
 *   3. Session is stored via supabase.auth.setSession() + persisted
 *      locally, and we navigate to /home.
 *
 * NOTE: In the real Device Owner flow the QR code is scanned during Android
 * factory-reset setup wizard, before this screen ever appears. This manual
 * code entry path is the fallback for devices that already have the app
 * installed (Device Admin mode, not Device Owner).
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Link2, Loader2, Smartphone, ShieldCheck, KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { saveDeviceCreds } from '../../lib/deviceStore.js'
import { useDeviceState } from '../../store/childDeviceState.js'
import { useDeviceModeStore } from '../../store/deviceModeStore.js'
import { syncSessionAndStartTracking } from '../../lib/locationPlugin.js'

export default function EnrollmentPage() {
  const navigate = useNavigate()
  const setEnrolled = useDeviceState((s) => s.setEnrolled)
  const revoked = useDeviceState((s) => s.revoked)

  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [linked, setLinked] = useState(null)

  async function handleEnroll(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const trimmed = cleanCode(code)

      const { data, error: fnErr } = await supabase.functions.invoke('pc-redeem-pairing-code', {
        body: { pairing_code: trimmed },
      })

      if (fnErr) throw new Error(await pairingErrorMessage(fnErr))
      if (!data?.ok) throw new Error(data?.error || 'That code didn\u2019t work. Ask your parent for a new one.')

      // This screen can be reached while a PARENT is signed in on this same
      // device (the normal way a parent sets up a child's device: log in as
      // themselves briefly, choose "This is my child's device", pair, done).
      // Clear that org session first so the two never overlap in the same
      // Supabase client — the device's own tokens below become the only
      // session this device uses from now on.
      await supabase.auth.signOut().catch(() => {})

      // Establish the real Supabase session for this device
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })
      if (sessionErr) throw sessionErr

      const creds = {
        deviceId: data.device_id,
        childId: data.child_id,
        orgId: data.org_id,
        childName: data.child_name,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        enrolledAt: new Date().toISOString(),
        // See src/lib/deviceStore.js isOrgMemberDevice() — decides whether
        // App.jsx shows the full org app (+ Family section) or the legacy
        // fully-isolated child experience.
        isOrgMember: !!data.is_org_member,
      }

      saveDeviceCreds(creds)
      setEnrolled(creds)
      // Safety net: pairing implies this device is now in child mode even
      // if DeviceModeSetupPage was somehow skipped (e.g. a direct deep link).
      useDeviceModeStore.getState().setMode('child')

      // Fire-and-forget — location permission prompt/tracking start
      // shouldn't block navigation to the home screen.
      syncSessionAndStartTracking().catch(() => {})

      // A device linked to a real org member (see 68_child_org_link_and_tamper.sql)
      // gets the full org app instead of the isolated child shell — App.jsx
      // re-renders into the normal <Routes> tree the instant isOrgMember
      // flips true, which has no /child/* routes at all, so send it to the
      // Family section's real path instead of the (now unreachable) one.
      // Straight into the one-at-a-time permission wizard: every grant
      // below is a manual system prompt, and asking for them right after
      // pairing (while a parent is still holding the phone) is the only
      // moment they reliably get done.
      setLinked({ parent: data.parent_name || 'your parent', child: data.child_name || '' })
      setTimeout(() => navigate(data.is_org_member ? '/family' : '/child/setup', { replace: true }), 1600)
    } catch (err) {
      setError(navigator.onLine === false ? 'No internet connection. Connect to Wi-Fi or mobile data and try again.' : err.message)
    } finally {
      setLoading(false)
    }
  }

  if (linked) {
    return (
      <div className="min-h-svh grad-brand text-white flex flex-col items-center justify-center px-8 text-center gap-5">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14, stiffness: 220 }}
          className="w-24 h-24 rounded-full bg-white/15 border border-white/25 flex items-center justify-center"
        >
          <Check size={48} strokeWidth={2.5} />
        </motion.div>
        <h1 className="text-2xl font-bold">Linked with {linked.parent}</h1>
        <p className="text-white/75 text-sm max-w-xs">Next: a few quick permissions so protection can switch on.</p>
      </div>
    )
  }

  const chars = code.padEnd(CODE_LENGTH, ' ').slice(0, CODE_LENGTH).split('')
  const ready = code.length === CODE_LENGTH

  return (
    <div className="min-h-svh app-bg flex flex-col">
      <header
        className="grad-brand text-white px-7 pb-16 rounded-b-[2.5rem] text-center"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}
      >
        <div className="w-16 h-16 rounded-[var(--radius-lg)] bg-white/15 border border-white/25 flex items-center justify-center mx-auto mb-4">
          <Link2 size={30} />
        </div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Link this phone</h1>
        <p className="text-sm text-white/75 mt-2 max-w-xs mx-auto">Type the 6-letter code shown on your parent’s phone.</p>
      </header>

      <main className="flex-1 px-6 -mt-10 pb-8 flex flex-col gap-4 w-full max-w-md mx-auto">
        <form onSubmit={handleEnroll} className="bg-[var(--surface)] border border-[var(--border-color)] rounded-[var(--radius-xl)] shadow-[var(--shadow-3)] p-6 flex flex-col gap-5">
          {revoked && (
            <p className="rounded-[var(--radius-md)] px-4 py-3 text-sm bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
              This phone was removed by a parent, so all limits are off. Ask a parent for a new code to link it again.
            </p>
          )}

          {/* One real input (keyboard, paste, autofill) under six display boxes. */}
          <label className="relative block" htmlFor="pair-code">
            <span className="sr-only">Pairing code</span>
            <div className="grid grid-cols-6 gap-2" aria-hidden="true">
              {chars.map((c, i) => (
                <span
                  key={i}
                  className={`h-14 rounded-[var(--radius-md)] border-2 flex items-center justify-center text-2xl font-bold font-mono transition-colors ${
                    i === code.length && !loading
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                      : c.trim()
                        ? 'border-[var(--border-strong)] bg-[var(--surface)] text-primary-token'
                        : 'border-[var(--border-color)] bg-[var(--surface-muted)]'
                  }`}
                >
                  {c.trim()}
                </span>
              ))}
            </div>
            <input
              id="pair-code"
              type="text"
              value={code}
              onChange={(e) => { setError(null); setCode(cleanCode(e.target.value)) }}
              maxLength={CODE_LENGTH + 4}
              className="!absolute inset-0 !opacity-0 !h-full !w-full cursor-text"
              disabled={loading}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)] text-center -mt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !ready}
            className="press w-full h-14 rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-[var(--color-on-primary)] font-bold text-base flex items-center justify-center gap-2 shadow-[var(--shadow-2)] disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? <><Loader2 size={20} className="animate-spin" /> Linking…</> : 'Link this phone'}
          </button>
        </form>

        <ol className="space-y-3 px-1">
          {[
            ['On your parent’s phone, open VOICE → Family.', Smartphone],
            ['Choose your name → Protection → Add a phone.', ShieldCheck],
            ['Type the code here. It works once and lasts 10 minutes.', KeyRound],
          ].map(([text, Icon], i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-secondary-token">
              <span className="w-8 h-8 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                <Icon size={16} />
              </span>
              <span className="pt-1.5">{text}</span>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}

const CODE_LENGTH = 6
// Same alphabet as pc-generate-pairing-code (no O/0/I/1), so a mistyped
// "0" for "O" can't silently produce a code that will never match.
const cleanCode = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)

/**
 * supabase.functions.invoke() hides the server's message behind "non-2xx
 * status"; read the response so the child sees WHY the code failed.
 */
async function pairingErrorMessage(fnErr) {
  const res = fnErr?.context
  const status = res?.status
  if (status === 410) return 'That code has expired. Codes last 10 minutes \u2014 ask your parent for a new one.'
  if (status === 404) return 'That code isn\u2019t valid or was already used. Check the letters, or ask your parent for a new code.'
  if (status === 429) return 'Too many tries. Wait a minute and try again.'
  if (!status) return 'Couldn\u2019t reach VOICE. Check the internet connection and try again.'
  try {
    const body = await res.json()
    if (body?.error) return body.error
  } catch {
    // fall through
  }
  return 'Pairing didn\u2019t work. Please try again.'
}
