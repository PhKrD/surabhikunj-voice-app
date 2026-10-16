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
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronRight, ShieldCheck, Loader2 } from 'lucide-react'
import { SETUP_STEPS, readSetupStatus, isSetupComplete } from '../../lib/setupSteps.js'
import { dpc } from '../../lib/dpcPlugin.js'
import { oemGuidance } from '../../lib/protectionHealth.js'

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
  const [manufacturer, setManufacturer] = useState(null)

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
      .then((snap) => { setVpnWanted(!!snap?.vpnFilteringEnabled); setManufacturer(snap?.manufacturer ?? null) })
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
  const granted = status ? steps.filter((s) => status[s.key]).length : 0
  const percent = steps.length ? Math.round((granted / steps.length) * 100) : 0

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
      <div className="min-h-svh grad-brand flex items-center justify-center text-white/80">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (done) {
    const complete = isSetupComplete(status)
    return (
      <div className="min-h-svh grad-brand text-white flex flex-col items-center justify-center px-8 gap-6 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14, stiffness: 220 }}
          className="w-24 h-24 rounded-full bg-white/15 border border-white/25 flex items-center justify-center"
        >
          <ShieldCheck size={44} />
        </motion.div>
        <h1 className="text-2xl font-bold">{complete ? 'You’re all set' : 'Almost there'}</h1>
        <p className="text-white/75 text-sm leading-relaxed max-w-xs">
          {complete
            ? 'Protection is on. You can ask your parent for more time whenever you need it.'
            : 'A few things are still off. The home screen will remind you, and you can turn them on any time.'}
        </p>
        <button type="button" onClick={finish} className="press w-full max-w-xs h-14 bg-white text-[var(--color-primary-700)] font-bold rounded-[var(--radius-lg)]">
          Continue
        </button>
      </div>
    )
  }

  const Icon = step.icon
  const stepNumber = index + 1
  const oem = step.key === 'battery' ? oemGuidance(manufacturer) : null

  return (
    <div
      className="min-h-svh grad-brand text-white flex flex-col px-6 pb-8 overflow-hidden"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}
    >
      {/* Progress */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white/85">Protection setup</p>
        <p className="text-sm font-bold tabular-nums" aria-live="polite">{percent}%</p>
      </div>
      <div className="flex items-center gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              status[s.key] ? 'bg-emerald-300' : i === index ? 'bg-white' : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.key}
          initial={{ x: 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -48, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 flex flex-col justify-center gap-6 py-8"
        >
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 rounded-[1.75rem] bg-white/10 rotate-6" aria-hidden />
            <div className="relative w-24 h-24 rounded-[1.75rem] bg-white/15 border border-white/25 flex items-center justify-center">
              <Icon size={40} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              Step {stepNumber} of {steps.length}{!step.required && ' · optional'}
            </p>
            <h1 className="text-[1.875rem] font-bold leading-tight mt-2">{step.label}</h1>
            <p className="text-white/80 mt-3 leading-relaxed">{step.why}</p>
            {oem && (
              <div className="mt-4 rounded-[var(--radius-lg)] bg-white/10 border border-white/15 p-4 space-y-2">
                <p className="text-sm font-semibold">Also on {oem.brand} phones:</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-white/80">
                  {oem.steps.map((t) => <li key={t}>{t}</li>)}
                </ol>
              </div>
            )}
            {step.hint && (
              <div className="mt-4 rounded-[var(--radius-lg)] bg-white/10 border border-white/15 p-4">
                <p className="text-sm text-white/80">{step.hint}</p>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleAllow}
          disabled={working}
          className="press w-full h-14 bg-white text-[var(--color-primary-700)] font-bold rounded-[var(--radius-lg)] flex items-center justify-center gap-2 shadow-[var(--shadow-3)] disabled:opacity-60"
        >
          {working ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} />}
          {step.action}
        </button>
        <button
          type="button"
          onClick={() => setCursor(index + 1)}
          className="w-full h-12 text-white/70 font-medium flex items-center justify-center gap-1"
        >
          {step.required ? 'I’ll do this later' : 'Skip'} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
