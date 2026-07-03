import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Mail, Lock, User, Eye, EyeOff } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export default function LoginPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [spiritualName, setSpiritualName] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { signInWithEmail, signUpWithEmail } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password)
      } else {
        await signUpWithEmail(email, password, spiritualName)
      }
      navigate('/')
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
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
        {/* Header */}
        <div className="text-center mb-7">
          <motion.div
            initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 14 }}
            className="w-16 h-16 grad-saffron rounded-3xl flex items-center justify-center mx-auto mb-4 glow-saffron animate-float-slow"
          >
            <Flame className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-saffron-600 via-saffron-500 to-lotus-500 bg-clip-text text-transparent">
            SurabhiKunj VOICE
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 max-w-xs mx-auto">
            Vaishnava Organisation for Inspired &amp; Committed Enthusiasts
          </p>
        </div>

        {/* Glass Card */}
        <div className="bg-white/70 backdrop-blur-2xl rounded-[2rem] shadow-[0_24px_70px_-20px_rgba(15,23,42,0.30)] border border-white/60 p-7 sm:p-8">
          {/* Tabs with sliding pill */}
          <div className="relative flex bg-slate-100/80 rounded-2xl p-1 mb-6">
            {['login', 'signup'].map((tab) => (
              <button
                key={tab}
                onClick={() => { setMode(tab); setError('') }}
                className="relative flex-1 py-2.5 text-sm font-semibold rounded-xl z-10"
              >
                {mode === tab && (
                  <motion.span
                    layoutId="authTabPill"
                    className="absolute inset-0 bg-white rounded-xl shadow-sm"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className={cn('relative transition-colors', mode === tab ? 'text-saffron-600' : 'text-slate-500')}>
                  {tab === 'login' ? 'Sign In' : 'Sign Up'}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
                <input
                  type="text"
                  placeholder="Spiritual Name (e.g. Palanhar Krsna Das)"
                  value={spiritualName}
                  onChange={(e) => setSpiritualName(e.target.value)}
                  required
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 focus:bg-white transition-all"
                />
              </div>
            )}

            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 focus:bg-white transition-all"
              />
            </div>

            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
              <input
                type={showPass ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-11 pr-11 py-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-saffron-500 transition-colors"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3"
                >
                  <p className="text-sm text-red-600">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" loading={loading} size="lg" className="w-full mt-1">
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Hare Krishna 🙏 — All glories to Srila Prabhupada
          </p>
        </div>
      </motion.div>
    </div>
  )
}
