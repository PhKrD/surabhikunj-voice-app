/**
 * PermissionWizardPage.jsx
 *
 * The one-permission-at-a-time setup a device runs through right after
 * pairing. Replaces the old "here is a list of six things, good luck"
 * checklist as the FIRST experience — the checklist still exists on the
 * home screen for anything later revoked.
 *
 * It auto-advances: every grant is a trip out to a system screen and back,
 * so the wizard re-checks on every return to the foreground and moves on
 * by itself the moment the current step is satisfied. Nothing is skipped
 * silently — required steps can be postponed, but the home screen keeps
 * asking.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ShieldCheck, Loader2 } from 'lucide-react'
import { SETUP_STEPS, readSetupStatus, isSetupComplete } from '../../lib/setupSteps.js'
import { dpc } from '../../lib/dpcPlugin.js'

export default function PermissionWizardPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  // Only ever moved by the "skip" button. The step actually shown is
  // DERIVED from it plus the live grant status, so a permission granted
  // out in Settings advances the wizard on its own without an effect
  // racing the render.
  const [cursor, setCursor] = useState(0)
  const [working, setWorking] = useState(false)
  const [vpnWanted, setVpnWanted] = useState(false)

  const steps = useMemo(() => SETUP_STEPS.filter((s) => !s.optIn || vpnWanted), [vpnWanted])

  const index = useMemo(() => {
    if (!status) return cursor
    const pending = steps.findIndex((s, i) => i >= cursor && !status[s.key])
    return pending === -1 ? steps.length : pending
  }, [steps, cursor, status])

  const step = steps[index]

  const refresh = useCallback(async () => setStatus(await readSetupStatus()), [])

  // Only offer the VPN step if a parent actually turned VPN filtering on.
  useEffect(() => {
    dpc.getEnforcementSnapshot()
      .then((snap) => setVpnWanted(!!snap?.vpnFilteringEnabled))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const run = () => refresh()
    const timer = setTimeout(run, 0)
    document.addEventListener('visibilitychange', run)
    // Belt and braces: some OEM permission screens return without firing
    // visibilitychange in the WebView.
    const poll = setInterval(run, 2000)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', run)
    }
  }, [refresh])

  const done = status && index >= steps.length

  const handleAllow = async () => {
    if (!step) return
    setWorking(true)
    try {
      await step.request()
    } catch {
      // The system screen either opened or it didn't — the status poll is
      // the source of truth either way.
    } finally {
      setWorking(false)
    }
  }

  const finish = () => navigate('/child/home', { replace: true })

  if (!status) {
    return (
      <div className="min-h-screen bg-indigo-950 flex items-center justify-center text-indigo-200">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (done) {
    const complete = isSetupComplete(status)
    return (
      <div className="min-h-screen bg-indigo-950 text-white flex flex-col items-center justify-center px-8 gap-6 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <ShieldCheck size={40} className="text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold">{complete ? "You're all set" : 'Almost there'}</h1>
        <p className="text-indigo-300 text-sm leading-relaxed max-w-xs">
          {complete
            ? 'VOICE is set up on this device. Your parents can now help manage screen time.'
            : 'A few optional things are still off. You can turn them on any time from the home screen.'}
        </p>
        <button onClick={finish} className="w-full max-w-xs bg-white text-indigo-700 font-bold rounded-2xl py-4">
          Continue
        </button>
      </div>
    )
  }

  const Icon = step.icon
  const stepNumber = index + 1

  return (
    <div className="min-h-screen bg-indigo-950 text-white flex flex-col px-7 pt-14 pb-8">
      {/* Progress */}
      <div className="flex items-center gap-1.5 mb-10">
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              status[s.key] ? 'bg-emerald-400' : i === index ? 'bg-white' : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
        Step {stepNumber} of {steps.length}
        {!step.required && <span className="text-indigo-500 normal-case tracking-normal"> · optional</span>}
      </p>

      <div className="flex-1 flex flex-col justify-center gap-6 -mt-8">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
          <Icon size={30} className="text-indigo-300" />
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">{step.label}</h1>
          <p className="text-indigo-300 mt-3 leading-relaxed">{step.why}</p>
          {step.hint && (
            <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-sm text-indigo-200">{step.hint}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleAllow}
          disabled={working}
          className="w-full bg-white text-indigo-700 font-bold rounded-2xl py-4 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {working ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} />}
          {step.action}
        </button>
        <button
          onClick={() => setCursor(index + 1)}
          className="w-full text-indigo-400 font-medium py-3 flex items-center justify-center gap-1"
        >
          {step.required ? 'I’ll do this later' : 'Skip'} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
