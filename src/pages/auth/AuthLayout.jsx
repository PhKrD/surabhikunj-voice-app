import { motion } from 'framer-motion'
import { Flame, ShieldCheck, Sparkles, Users } from 'lucide-react'

const HIGHLIGHTS = [
  { icon: Sparkles, text: 'Daily Sadhana tracking with clear progress' },
  { icon: Users, text: 'Seva, events and announcements in one place' },
  { icon: ShieldCheck, text: 'Private to your community, secured by role' },
]

/**
 * Shared frame for sign-in, sign-up and password reset: a brand panel on
 * wide screens, a compact brand header on phones, and the form card.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-svh app-bg flex overflow-y-auto">
      {/* Brand panel — tablets and desktop */}
      <aside className="hidden lg:flex lg:w-[44%] xl:w-[40%] relative flex-col justify-between p-12 bg-[var(--color-primary)] text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.12] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0, transparent 40%), radial-gradient(circle at 85% 75%, #ffb870 0, transparent 35%)' }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-[var(--radius-md)] bg-white/15 flex items-center justify-center">
            <Flame className="w-6 h-6" aria-hidden="true" />
          </div>
          <span className="text-lg font-bold tracking-[0.2em]">VOICE</span>
        </div>
        <div className="relative">
          <h2 className="text-[2.25rem] leading-tight font-bold tracking-tight max-w-md">
            Your community’s spiritual life, beautifully organised.
          </h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/90">
                <span className="w-9 h-9 rounded-[var(--radius-sm)] bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Hare Krishna · All glories to Srila Prabhupada</p>
      </aside>

      {/* Form */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 pt-safe pb-safe">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[25rem] py-10"
        >
          <div className="lg:hidden flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 rounded-[1.25rem] bg-[var(--color-primary)] flex items-center justify-center shadow-[var(--shadow-3)]">
              <Flame className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <span className="mt-4 text-sm font-bold tracking-[0.25em] text-[var(--color-primary)]">VOICE</span>
          </div>

          <div className="mb-6 text-center lg:text-left">
            <h1 className="text-display text-primary-token">{title}</h1>
            {subtitle && <p className="text-body text-secondary-token mt-2">{subtitle}</p>}
          </div>

          {children}

          {footer && <div className="mt-8 text-center">{footer}</div>}
        </motion.div>
      </main>
    </div>
  )
}
