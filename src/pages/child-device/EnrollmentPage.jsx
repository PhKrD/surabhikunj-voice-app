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

  async function handleEnroll(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const trimmed = code.trim().toUpperCase()

      const { data, error: fnErr } = await supabase.functions.invoke('pc-redeem-pairing-code', {
        body: { pairing_code: trimmed },
      })

      if (fnErr) throw new Error(fnErr.message || 'Could not redeem pairing code')
      if (!data?.ok) throw new Error(data?.error || 'Invalid or expired pairing code')

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
      navigate(data.is_org_member ? '/family' : '/child/setup', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-indigo-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 flex flex-col gap-6">
        {/* Logo / title */}
        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-600/30">
            <span className="text-white text-2xl font-bold">V</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">VOICE</h1>
          <p className="text-sm text-gray-500 mt-1">Enter the pairing code from a parent's device</p>
        </div>

        {revoked && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            This device was removed by a parent. All restrictions have been lifted. Ask a parent for a new pairing code to reconnect.
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleEnroll} className="flex flex-col gap-4">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. AB12CD"
            maxLength={8}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={loading}
            autoComplete="off"
            autoCapitalize="characters"
          />

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || code.trim().length < 4}
            className="w-full bg-indigo-600 active:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-2xl py-3.5 transition-colors"
          >
            {loading ? 'Pairing…' : 'Pair this device'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center">
          Ask a parent to open VOICE → Parental Control → Devices → Add a device to get the code.
        </p>
      </div>
    </div>
  )
}
