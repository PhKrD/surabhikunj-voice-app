import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, KeyRound, ArrowRight, ArrowLeft, Loader2,
  Clock, Copy, Check, LogOut, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const INPUT =
  'w-full px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 focus:bg-white transition-all'

// ─── Choice cards ─────────────────────────────────────────────────────────────
function ChoiceCard({ icon: Icon, title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-5 rounded-2xl border border-slate-200 bg-white hover:border-saffron-300 hover:shadow-[0_12px_32px_-16px_rgba(249,115,22,0.35)] transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl grad-saffron flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-800">{title}</p>
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-saffron-500 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-3" />
      </div>
    </button>
  )
}

// ─── Create an organization ───────────────────────────────────────────────────
function CreateOrgForm({ onBack, onDone }) {
  const toast = useToastStore()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (name.trim().length < 3) {
      toast.error('Name too short', 'Use at least 3 characters.')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('create_organization', { p_name: name.trim() })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.org_id) throw new Error('Organization was not created')
      setResult(row)
    } catch (err) {
      toast.error('Could not create organization', err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(result.join_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed', 'Select and copy the code manually.')
    }
  }

  if (result) {
    return (
      <div className="space-y-5 text-center">
        <div className="w-14 h-14 rounded-3xl grad-tulasi flex items-center justify-center mx-auto">
          <Check className="w-7 h-7 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-slate-800">You're all set</h2>
          <p className="text-sm text-slate-500 mt-1">
            You are the owner of <span className="font-semibold text-slate-700">{name.trim()}</span>.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-saffron-50 border border-saffron-100">
          <p className="text-xs font-medium text-slate-500 mb-1.5">
            Share this join code with your members
          </p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-2xl font-extrabold tracking-[0.2em] text-saffron-700">
              {result.join_code}
            </code>
            <button
              onClick={copyCode}
              className="p-2 rounded-xl text-saffron-600 hover:bg-saffron-100 transition-colors"
              title="Copy code"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            You can find this again in Settings → Organization.
          </p>
        </div>

        <Button className="w-full" size="lg" onClick={onDone}>
          Go to Dashboard
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div>
        <h2 className="text-xl font-extrabold text-slate-800">Create your organization</h2>
        <p className="text-sm text-slate-500 mt-1">
          You'll become its owner with full control over members, roles and modules.
        </p>
      </div>

      <div className="relative group">
        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
        <input
          type="text"
          placeholder="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          className={`${INPUT} pl-11`}
        />
      </div>

      <Button type="submit" loading={loading} size="lg" className="w-full">
        Create organization
      </Button>
    </form>
  )
}

// ─── Join with a code ─────────────────────────────────────────────────────────
function JoinOrgForm({ onBack, onDone, onPending }) {
  const toast = useToastStore()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [peek, setPeek] = useState(null)

  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

  // Look up the org name once the code is complete, so the user can confirm
  useEffect(() => {
    if (clean.length !== 7) { setPeek(null); return }
    let cancelled = false
    supabase.rpc('peek_organization', { p_code: clean }).then(({ data }) => {
      if (cancelled) return
      const row = Array.isArray(data) ? data[0] : data
      setPeek(row ?? null)
    })
    return () => { cancelled = true }
  }, [clean])

  const submit = async (e) => {
    e.preventDefault()
    if (!clean) {
      toast.error('Enter a join code')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('join_organization_by_code', { p_code: clean })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.org_id) throw new Error('Could not join that organization')

      if (row.status === 'active') {
        toast.success('Joined', `Welcome to ${row.org_name}.`)
        onDone()
      } else {
        onPending(row.org_name)
      }
    } catch (err) {
      toast.error('Could not join', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div>
        <h2 className="text-xl font-extrabold text-slate-800">Join an organization</h2>
        <p className="text-sm text-slate-500 mt-1">
          Enter the 7-character join code from your organization's admin.
        </p>
      </div>

      <div className="relative group">
        <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
        <input
          type="text"
          placeholder="ABC2XYZ"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className={`${INPUT} pl-11 tracking-[0.25em] font-semibold uppercase`}
        />
      </div>

      <AnimatePresence>
        {peek && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-tulasi-50 border border-tulasi-100"
          >
            <Users className="w-4 h-4 text-tulasi-600 flex-shrink-0" />
            <p className="text-sm text-slate-700">
              Joining <span className="font-semibold">{peek.org_name}</span>
              <span className="text-slate-400"> · {peek.member_count} members</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <Button type="submit" loading={loading} size="lg" className="w-full" disabled={!clean}>
        Join organization
      </Button>
    </form>
  )
}

// ─── Awaiting approval ────────────────────────────────────────────────────────
function PendingState({ orgName, onRecheck, checking }) {
  return (
    <div className="space-y-5 text-center">
      <div className="w-14 h-14 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto">
        <Clock className="w-7 h-7 text-amber-600" />
      </div>
      <div>
        <h2 className="text-xl font-extrabold text-slate-800">Waiting for approval</h2>
        <p className="text-sm text-slate-500 mt-1">
          Your request to join{' '}
          <span className="font-semibold text-slate-700">{orgName}</span> has been sent.
          An admin needs to approve it before you can continue.
        </p>
      </div>
      <Button variant="secondary" className="w-full" onClick={onRecheck} loading={checking}>
        Check again
      </Button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()
  const { refresh } = useOrgStore()

  const [view, setView]         = useState('choose') // choose | create | join | pending
  const [pendingOrg, setPending] = useState(null)
  const [checking, setChecking] = useState(false)
  const [booting, setBooting]   = useState(true)

  // On mount:
  //   1. Run ensure_active_org() — if the user already has an active
  //      membership (e.g. an admin who created the org), this writes
  //      active_org_id back into their profile, then refresh() will
  //      find the org and navigate home without showing this form at all.
  //   2. Otherwise check for pending memberships so we can show the wait screen.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: orgId } = await supabase.rpc('ensure_active_org')
        if (cancelled) return
        if (orgId) {
          // Active org restored — refresh org context and go home
          await refresh()
          if (!useOrgStore.getState().needsOnboarding) {
            navigate('/', { replace: true })
            return
          }
        }
        // No active org — check pending
        const { data } = await supabase.rpc('my_pending_memberships')
        if (cancelled) return
        const row = (data ?? [])[0]
        if (row) { setPending(row.org_name); setView('pending') }
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-load org context; if a membership is now active we leave onboarding
  const finish = useCallback(async () => {
    await refresh()
    if (!useOrgStore.getState().needsOnboarding) navigate('/', { replace: true })
  }, [refresh, navigate])

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      await refresh()
      if (!useOrgStore.getState().needsOnboarding) {
        navigate('/', { replace: true })
      }
    } finally {
      setChecking(false)
    }
  }, [refresh, navigate])

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg">
        <Loader2 className="w-7 h-7 text-saffron-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden app-bg">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full grad-saffron opacity-25 blur-3xl animate-float-slow" />
        <div className="absolute -bottom-32 right-0 w-[26rem] h-[26rem] rounded-full grad-blue opacity-20 blur-3xl animate-float-slow" style={{ animationDelay: '1.6s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="bg-white/75 backdrop-blur-2xl rounded-[2rem] shadow-[0_24px_70px_-20px_rgba(15,23,42,0.30)] border border-white/60 p-7 sm:p-8">
          {view === 'choose' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-800">
                  Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  You're signed in but not part of an organization yet.
                </p>
              </div>

              <div className="space-y-3">
                <ChoiceCard
                  icon={KeyRound}
                  title="I have a join code"
                  description="Join an organization that already exists."
                  onClick={() => setView('join')}
                />
                <ChoiceCard
                  icon={Building2}
                  title="Create a new organization"
                  description="Set one up from scratch and invite your members."
                  onClick={() => setView('create')}
                />
              </div>
            </div>
          )}

          {view === 'create' && (
            <CreateOrgForm onBack={() => setView('choose')} onDone={finish} />
          )}

          {view === 'join' && (
            <JoinOrgForm
              onBack={() => setView('choose')}
              onDone={finish}
              onPending={(orgName) => { setPending(orgName); setView('pending') }}
            />
          )}

          {view === 'pending' && (
            <PendingState orgName={pendingOrg} onRecheck={recheck} checking={checking} />
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-400 truncate">{profile?.email}</p>
            <button
              onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium text-slate-400',
                'hover:text-red-500 transition-colors flex-shrink-0'
              )}
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
