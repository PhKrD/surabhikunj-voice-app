import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Clock, RefreshCw, LogOut, MailCheck } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import Button from '@/components/ui/Button'

export default function PendingApproval() {
  const { user, profile, fetchProfile, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleCheckAgain = async () => {
    if (!user?.id || checking) return
    setChecking(true)
    await fetchProfile(user.id)
    setTimeout(() => setChecking(false), 500)
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await signOut()
    navigate('/login', { replace: true })
    setTimeout(() => {
      if (window.location.pathname !== '/login') window.location.assign('/login')
      setSigningOut(false)
    }, 100)
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden app-bg">
      {/* Animated gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full grad-saffron opacity-30 blur-3xl animate-float-slow" />
        <div className="absolute top-1/4 -right-32 w-[26rem] h-[26rem] rounded-full grad-lotus opacity-25 blur-3xl animate-float-slow" style={{ animationDelay: '1.2s' }} />
        <div className="absolute -bottom-32 left-1/4 w-[26rem] h-[26rem] rounded-full grad-blue opacity-20 blur-3xl animate-float-slow" style={{ animationDelay: '2.4s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="bg-white/70 backdrop-blur-2xl rounded-[2rem] shadow-[0_24px_70px_-20px_rgba(15,23,42,0.30)] border border-white/60 p-8 text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 14 }}
            className="w-16 h-16 grad-amber rounded-3xl flex items-center justify-center mx-auto mb-5 glow-saffron animate-float-slow"
          >
            <Clock className="w-8 h-8 text-white" />
          </motion.div>

          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">
            Awaiting Approval
          </h1>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            Hare Krishna{profile?.spiritual_name ? `, ${profile.spiritual_name.split(' ')[0]}` : ''} 🙏
            <br />
            Your account has been created and is <span className="font-semibold text-slate-700">pending approval</span> by an administrator.
            You'll get full access once an admin assigns your role.
          </p>

          {profile?.email && (
            <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-100/80 text-slate-600 text-sm">
              <MailCheck className="w-4 h-4 text-tulasi-500" />
              <span className="font-medium">{profile.email}</span>
            </div>
          )}

          <div className="mt-7 space-y-3">
            <Button onClick={handleCheckAgain} loading={checking} icon={RefreshCw} size="lg" className="w-full">
              Check Again
            </Button>
            <Button onClick={handleSignOut} loading={signingOut} icon={LogOut} variant="secondary" size="lg" className="w-full">
              Sign Out
            </Button>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Please contact your VOICE administrator if this takes long.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
