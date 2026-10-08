import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Mail, Lock, User, ArrowLeft, MailCheck, AlertCircle } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import Button from '@/components/ui/Button'
import { AppInput } from '@/components/ui/Field'
import { friendlyError } from '@/lib/friendlyError'
import { cn } from '@/lib/utils'
import AuthLayout from './AuthLayout'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

const COPY = {
  login: { title: 'Welcome back', subtitle: 'Sign in to continue to your community.', cta: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Then start or join your organization with a code.', cta: 'Create account' },
  forgot: { title: 'Reset your password', subtitle: 'We’ll email you a link to choose a new one.', cta: 'Send reset link' },
}

function validate(mode, { email, password, name }) {
  const errors = {}
  if (mode === 'signup' && !name.trim()) errors.name = 'Please enter your name.'
  if (!email.trim()) errors.email = 'Please enter your email.'
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'That doesn’t look like an email address.'
  if (mode !== 'forgot') {
    if (!password) errors.password = 'Please enter your password.'
    else if (mode === 'signup' && password.length < MIN_PASSWORD) {
      errors.password = `Use at least ${MIN_PASSWORD} characters.`
    }
  }
  return errors
}

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  // 'reset' | 'confirm' — a "check your inbox" message after sending email.
  const [sent, setSent] = useState(null)

  const { user, signInWithEmail, signUpWithEmail, resetPassword } = useAuthStore()
  // Typing in a field clears its error; the rest stay until the next submit.
  const clearError = (key) => setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  const navigate = useNavigate()

  if (user && !sent) return <Navigate to="/" replace />

  const switchMode = (next) => {
    setMode(next)
    setFieldErrors({})
    setFormError('')
    setSent(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    const errors = validate(mode, { email, password, name })
    setFieldErrors(errors)
    setFormError('')
    if (Object.keys(errors).length) return

    setLoading(true)
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password)
        navigate('/', { replace: true })
      } else if (mode === 'signup') {
        const data = await signUpWithEmail(email, password, name)
        // With email confirmation on, there is no session yet: say so,
        // instead of sending the user to a screen that bounces them back.
        if (data?.session) navigate('/', { replace: true })
        else setSent('confirm')
      } else {
        await resetPassword(email)
        setSent('reset')
      }
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your inbox">
        <div className="rounded-[var(--radius-xl)] bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-2)] p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
            <MailCheck className="w-7 h-7 text-[var(--color-success)]" aria-hidden="true" />
          </div>
          <p className="text-body text-secondary-token mt-4">
            {sent === 'reset' ? 'We sent a password reset link to ' : 'We sent a confirmation link to '}
            <span className="font-semibold text-primary-token break-all">{email.trim()}</span>.
            {sent === 'confirm' && ' Open it to activate your account, then sign in.'}
          </p>
          <p className="text-caption mt-2">Can’t find it? Check your spam folder.</p>
          <Button variant="secondary" className="w-full mt-6" icon={ArrowLeft} onClick={() => switchMode('login')}>
            Back to sign in
          </Button>
        </div>
      </AuthLayout>
    )
  }

  const copy = COPY[mode]

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<p className="text-caption">Hare Krishna 🙏 · All glories to Srila Prabhupada</p>}
    >
      <div className="rounded-[var(--radius-xl)] bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-2)] p-5 sm:p-6">
        {mode === 'forgot' ? (
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="mb-4 -ml-1 inline-flex items-center gap-1.5 h-9 px-2 rounded-[var(--radius-sm)] text-sm font-medium text-secondary-token hover:bg-[var(--surface-muted)]"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to sign in
          </button>
        ) : (
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 p-1 mb-5 rounded-[var(--radius-md)] bg-[var(--surface-muted)]">
            {['login', 'signup'].map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={mode === tab}
                onClick={() => switchMode(tab)}
                className={cn(
                  'relative h-10 rounded-[calc(var(--radius-md)-4px)] text-sm font-semibold transition-colors',
                  mode === tab ? 'text-primary-token' : 'text-muted-token hover:text-secondary-token',
                )}
              >
                {mode === tab && (
                  <motion.span
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-[calc(var(--radius-md)-4px)] bg-[var(--surface)] shadow-[var(--shadow-1)]"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">{tab === 'login' ? 'Sign in' : 'Create account'}</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {mode === 'signup' && (
            <AppInput
              label="Your name"
              icon={User}
              autoComplete="name"
              placeholder="e.g. Palanhar Krsna Das"
              value={name}
              onChange={(e) => { setName(e.target.value); clearError('name') }}
              error={fieldErrors.name}
            />
          )}

          <AppInput
            label="Email"
            type="email"
            icon={Mail}
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError('email') }}
            error={fieldErrors.email}
          />

          {mode !== 'forgot' && (
            <div>
              <AppInput
                label="Password"
                type="password"
                icon={Lock}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError('password') }}
                error={fieldErrors.password}
              />
              {mode === 'login' && (
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="h-9 px-1 text-sm font-semibold text-[var(--color-primary)] hover:underline underline-offset-2"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          )}

          <AnimatePresence>
            {formError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="alert"
                className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] px-3.5 py-3 text-sm text-[var(--color-danger)]"
              >
                <AlertCircle className="w-[18px] h-[18px] flex-shrink-0 mt-px" aria-hidden="true" />
                <span>{formError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <Button type="submit" size="lg" loading={loading} className="w-full">
            {copy.cta}
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
