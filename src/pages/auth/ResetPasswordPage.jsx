import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import Button from '@/components/ui/Button'
import { AppInput } from '@/components/ui/Field'
import { LoadingState } from '@/components/ui/States'
import { friendlyError } from '@/lib/friendlyError'
import AuthLayout from './AuthLayout'

const MIN_PASSWORD = 8

/**
 * Landing page for the link in a password-reset email. Supabase signs the
 * user in from the link (PASSWORD_RECOVERY), then they choose a new password.
 */
export default function ResetPasswordPage() {
  const { user, loading: authLoading, passwordRecovery, updatePassword } = useAuthStore()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  if (authLoading) return <LoadingState fullScreen />

  const linkValid = passwordRecovery || Boolean(user)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return
    const next = {}
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`
    if (confirmValue !== password) next.confirm = 'The passwords don’t match.'
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  if (!linkValid) {
    return (
      <AuthLayout title="Link expired" subtitle="This reset link is no longer valid. Request a new one from the sign-in screen.">
        <Button size="lg" className="w-full" onClick={() => navigate('/login', { replace: true })}>
          Back to sign in
        </Button>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <div className="rounded-[var(--radius-xl)] bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-2)] p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-[var(--color-success)]" aria-hidden="true" />
          </div>
          <p className="text-body text-secondary-token mt-4">
            You can now sign in with your new password — in this browser or in the app.
          </p>
          <Button size="lg" className="w-full mt-6" onClick={() => navigate('/', { replace: true })}>
            Continue
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Pick something you haven’t used before.">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-[var(--radius-xl)] bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-2)] p-5 sm:p-6 space-y-4"
      >
        <AppInput
          label="New password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <AppInput
          label="Confirm new password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          error={errors.confirm}
        />
        {formError && (
          <div role="alert" className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] px-3.5 py-3 text-sm text-[var(--color-danger)]">
            <AlertCircle className="w-[18px] h-[18px] flex-shrink-0 mt-px" aria-hidden="true" />
            {formError}
          </div>
        )}
        <Button type="submit" size="lg" loading={saving} className="w-full">
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
