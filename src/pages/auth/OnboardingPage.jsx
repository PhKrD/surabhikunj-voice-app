import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, KeyRound, ArrowRight, ArrowLeft, Clock, Copy, Check, LogOut, Users, Smartphone,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import { useToast } from '@/store/toastStore'
import Button from '@/components/ui/Button'
import { AppInput } from '@/components/ui/Field'
import { LoadingState } from '@/components/ui/States'
import { friendlyError } from '@/lib/friendlyError'
import { isDeviceAccount } from '@/lib/utils'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import AuthLayout from './AuthLayout'

const slide = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
}

function BackLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex items-center gap-1.5 h-10 px-2 rounded-full text-sm font-medium text-secondary-token hover:text-primary-token"
    >
      <ArrowLeft className="w-4 h-4" /> Back
    </button>
  )
}

// ─── Choice cards ─────────────────────────────────────────────────────────────
function ChoiceCard({ icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press group w-full text-left p-4 rounded-[var(--radius-lg)] border border-[var(--border-color)] bg-[var(--surface)] shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] hover:border-[var(--border-strong)] transition-shadow flex items-center gap-4"
    >
      <span className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-primary-token">{title}</span>
        <span className="block text-caption mt-0.5">{description}</span>
      </span>
      <ArrowRight className="w-5 h-5 text-muted-token group-hover:translate-x-0.5 transition-transform flex-shrink-0" aria-hidden="true" />
    </button>
  )
}

// ─── Create an organization ───────────────────────────────────────────────────
function CreateOrgForm({ onBack, onDone }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (name.trim().length < 3) {
      setError('Use at least 3 characters.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('create_organization', { p_name: name.trim() })
      if (rpcError) throw rpcError
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.org_id) throw new Error('Organization was not created')
      setResult(row)
    } catch (err) {
      toast.error('Could not create organization', friendlyError(err))
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
        <div className="w-16 h-16 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center mx-auto">
          <Check className="w-8 h-8 text-[var(--color-success)]" />
        </div>
        <div>
          <h2 className="text-title text-primary-token">You’re all set</h2>
          <p className="text-caption mt-1">
            You own <span className="font-semibold text-secondary-token">{name.trim()}</span>.
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-primary-soft)]">
          <p className="text-overline mb-2">Join code for your members</p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-[1.75rem] font-bold tracking-[0.2em] text-[var(--color-primary-strong)]">
              {result.join_code}
            </code>
            <button
              type="button"
              onClick={copyCode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-[var(--color-primary)] hover:bg-[var(--surface)]"
              aria-label="Copy code"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-muted-token mt-2">You can find it again in Settings → Organization.</p>
        </div>

        <Button className="w-full" size="lg" onClick={onDone}>Go to dashboard</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <BackLink onClick={onBack} />
      <AppInput
        label="Organization name"
        icon={Building2}
        placeholder="e.g. Surabhi Kunj"
        value={name}
        onChange={(e) => { setName(e.target.value); setError('') }}
        error={error}
        hint="You’ll be its owner, with full control over members, roles and modules."
        autoFocus
        required
      />
      <Button type="submit" loading={loading} size="lg" className="w-full">Create organization</Button>
    </form>
  )
}

// ─── Join with a code ─────────────────────────────────────────────────────────
function JoinOrgForm({ onBack, onDone, onPending }) {
  const toast = useToast()
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
    if (!clean) return
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
      toast.error('Could not join', friendlyError(err, 'That code didn’t work. Check it with your admin.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <BackLink onClick={onBack} />
      <AppInput
        label="Join code"
        icon={KeyRound}
        placeholder="ABC2XYZ"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={9}
        autoFocus
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        hint="7 characters, from your organization’s admin."
        className="tracking-[0.25em] font-semibold uppercase"
      />

      <AnimatePresence>
        {peek && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2.5 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--color-success-soft)]"
          >
            <Users className="w-4 h-4 text-[var(--color-success)] flex-shrink-0" />
            <p className="text-sm text-secondary-token">
              Joining <span className="font-semibold text-primary-token">{peek.org_name}</span>
              <span className="text-muted-token"> · {peek.member_count} members</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <Button type="submit" loading={loading} size="lg" className="w-full" disabled={!clean}>Join organization</Button>
    </form>
  )
}

// ─── Awaiting approval ────────────────────────────────────────────────────────
function PendingState({ orgName, onRecheck, checking }) {
  return (
    <div className="space-y-5 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--color-warning-soft)] flex items-center justify-center mx-auto">
        <Clock className="w-8 h-8 text-[var(--color-warning)]" />
      </div>
      <p className="text-body text-secondary-token">
        Your request to join <span className="font-semibold text-primary-token">{orgName}</span> was sent.
        An admin needs to approve it before you can continue.
      </p>
      <Button variant="secondary" size="lg" className="w-full" onClick={onRecheck} loading={checking}>Check again</Button>
    </div>
  )
}

const TITLES = {
  choose: (name) => ({ title: `Welcome${name ? `, ${name}` : ''}`, subtitle: 'You’re signed in. Now join your community, or start a new one.' }),
  create: () => ({ title: 'Create your organization', subtitle: 'Set it up, then share the join code with your members.' }),
  join: () => ({ title: 'Join your organization', subtitle: 'Enter the code your admin gave you.' }),
  pending: () => ({ title: 'Waiting for approval', subtitle: null }),
  device: () => ({ title: 'This is a supervised phone', subtitle: null }),
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()
  const { refresh } = useOrgStore()

  // A parental-control device account is never a member of anything; it
  // reaching this screen means Device Mode was reset on the phone. Joining
  // an org here is what put "device-…" into the member list before.
  const deviceAccount = isDeviceAccount(profile)
  const [view, setView]         = useState(deviceAccount ? 'device' : 'choose') // choose | create | join | pending | device
  const [pendingOrg, setPending] = useState(null)
  const [checking, setChecking] = useState(false)
  const [booting, setBooting]   = useState(!deviceAccount)

  // On mount:
  //   1. Run ensure_active_org() — if the user already has an active
  //      membership (e.g. an admin who created the org), this writes
  //      active_org_id back into their profile, then refresh() will
  //      find the org and navigate home without showing this form at all.
  //   2. Otherwise check for pending memberships so we can show the wait screen.
  useEffect(() => {
    if (deviceAccount) return undefined
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

  if (booting) return <LoadingState fullScreen label="Getting things ready…" />

  const { title, subtitle } = TITLES[view](profile?.display_name)

  return (
    <AuthLayout
      title={title}
      subtitle={subtitle}
      footer={
        <div className="flex items-center justify-between gap-3 pt-5 border-t border-[var(--border-color)]">
          <p className="text-xs text-muted-token truncate">{profile?.email}</p>
          <button
            type="button"
            onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
            className="inline-flex items-center gap-1.5 h-9 px-2 rounded-full text-xs font-semibold text-secondary-token hover:text-[var(--color-danger)] flex-shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} {...slide}>
          {view === 'choose' && (
            <div className="space-y-3">
              <ChoiceCard
                icon={KeyRound}
                title="I have a join code"
                description="Join a community that already uses VOICE."
                onClick={() => setView('join')}
              />
              <ChoiceCard
                icon={Building2}
                title="Create a new organization"
                description="Set one up from scratch and invite your members."
                onClick={() => setView('create')}
              />
            </div>
          )}

          {view === 'create' && <CreateOrgForm onBack={() => setView('choose')} onDone={finish} />}

          {view === 'join' && (
            <JoinOrgForm
              onBack={() => setView('choose')}
              onDone={finish}
              onPending={(orgName) => { setPending(orgName); setView('pending') }}
            />
          )}

          {view === 'pending' && <PendingState orgName={pendingOrg} onRecheck={recheck} checking={checking} />}

          {view === 'device' && (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[var(--color-primary-soft)] flex items-center justify-center mx-auto">
                <Smartphone className="w-8 h-8 text-[var(--color-primary)]" />
              </div>
              <p className="text-body text-secondary-token">
                This phone is linked to a child in Parental Control, so it can’t join an organization.
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() => { useDeviceModeStore.getState().setMode('child'); navigate('/child/home', { replace: true }) }}
              >
                Go to the child’s screen
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthLayout>
  )
}
