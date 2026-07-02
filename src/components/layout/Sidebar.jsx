import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import {
  LayoutDashboard, BookOpen, Users, Sparkles, Building2,
  UtensilsCrossed, CalendarDays, ListChecks, GitBranch,
  Bell, Settings, LogOut, X, Flame, Megaphone
} from 'lucide-react'
import { cn } from '@/lib/utils'
import useAuthStore from '@/store/authStore'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'

const navItems = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, tint: 'text-saffron-500' },
  { label: 'Residents', to: '/residents', icon: Users, tint: 'text-blue-500' },
  { label: 'Sadhana', to: '/sadhana', icon: BookOpen, tint: 'text-lotus-500' },
  { label: 'Counsellor', to: '/counsellor', icon: Users, tint: 'text-cyan-500' },
  { label: 'Departments', to: '/departments', icon: Building2, tint: 'text-indigo-500' },
  { label: 'Services (IM)', to: '/services', icon: ListChecks, tint: 'text-amber-500' },
  { label: 'Cleanliness', to: '/cleanliness', icon: Sparkles, tint: 'text-tulasi-500' },
  { label: 'Kitchen', to: '/kitchen', icon: UtensilsCrossed, tint: 'text-orange-500' },
  { label: 'Events', to: '/events', icon: CalendarDays, tint: 'text-rose-500' },
  { label: 'Org Structure', to: '/hierarchy', icon: GitBranch, tint: 'text-emerald-500' },
  { label: 'Announcements', to: '/announcements', icon: Megaphone, tint: 'text-fuchsia-500' },
]

const bottomItems = [
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Settings', to: '/settings', icon: Settings },
]

function NavItem({ item, collapsed, onClick }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-200 group',
          isActive
            ? 'grad-saffron text-white font-semibold shadow-[0_8px_18px_-8px_rgba(249,115,22,0.6)]'
            : 'text-slate-600 hover:bg-white hover:shadow-sm'
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            className={cn(
              'w-5 h-5 flex-shrink-0 transition-colors',
              isActive ? 'text-white' : cn(item.tint ?? 'text-slate-500', 'group-hover:scale-110')
            )}
          />
          {!collapsed && (
            <span className="text-sm truncate">{item.label}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

const COUNSELLOR_ROLES = ['counsellor', 'sadhana_incharge', 'admin', 'vmc', 'oc']

export default function Sidebar({ mobileOpen, onClose }) {
  const { profile, signOut, loginType, setLoginType } = useAuthStore()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const canBeCounsellor = COUNSELLOR_ROLES.includes(profile?.role)

  const toggleLoginType = () => {
    const newType = loginType === 'counsellor' ? 'counsellee' : 'counsellor'
    setLoginType(newType)
    navigate('/counsellor')
    onClose?.()
  }

  const handleSignOut = async () => {
    if (signingOut) return

    setSigningOut(true)
    const { error } = await signOut()
    if (error) {
      console.error('Sign out failed in sidebar:', error.message)
    }

    onClose?.()
    navigate('/login', { replace: true })

    setTimeout(() => {
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
      setSigningOut(false)
    }, 100)
  }

  const content = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 border-b border-slate-100">
        <div className="w-10 h-10 grad-saffron rounded-2xl flex items-center justify-center glow-saffron animate-float-slow">
          <Flame className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-extrabold text-slate-800 text-sm leading-tight tracking-tight">SurabhiKunj</p>
          <p className="text-[11px] text-saffron-600 font-bold tracking-widest">VOICE</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto lg:hidden p-1 rounded-lg text-slate-400 hover:text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Voice name */}
      {profile?.voices?.name && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-saffron-50 border border-saffron-100">
          <p className="text-xs text-saffron-700 font-medium truncate">{profile.voices.name}</p>
          {profile.voices.location && (
            <p className="text-xs text-slate-400 truncate">{profile.voices.location}</p>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => (
          <NavItem key={item.to} item={item} onClick={onClose} />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 pb-3 space-y-0.5 border-t border-slate-100 pt-3">
        {bottomItems.map((item) => (
          <NavItem key={item.to} item={item} onClick={onClose} />
        ))}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{signingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>

      {/* Profile */}
      {profile && (
        <div className="mx-3 mb-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={profile.spiritual_name} url={profile.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{profile.spiritual_name}</p>
              <Badge variant="saffron" className="text-xs">{profile.role}</Badge>
            </div>
          </div>
          {canBeCounsellor && (
            <button
              onClick={toggleLoginType}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-saffron-50 hover:text-saffron-700 hover:border-saffron-200 transition-all"
            >
              <Users className="w-4 h-4" />
              <span>
                View as: <span className="font-semibold">{loginType === 'counsellor' ? 'Counsellor' : 'Counsellee'}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-slate-100 bg-white/80 backdrop-blur-xl h-screen sticky top-0">
        {content}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40 lg:hidden"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-white z-50 shadow-2xl lg:hidden"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
