import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { cn } from '@/lib/utils'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import usePermission from '@/hooks/usePermission'
import { supabase } from '@/lib/supabase'

const BOTTOM_ROUTES = ['/notifications', '/settings']

function resolveIcon(name) {
  return LucideIcons[name] ?? LucideIcons.Circle
}

function labelFor(item) {
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  const key   = typeof item.key   === 'string' ? item.key.trim()   : ''
  return label || key || 'Menu'
}

function NavItem({ item, collapsed, onClick }) {
  const Icon = resolveIcon(item.icon)
  return (
    <NavLink
      to={item.route}
      end={item.route === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-200 group press',
          isActive
            ? 'text-white font-semibold shadow-[0_10px_22px_-8px_rgba(249,115,22,0.55)]'
            : 'text-slate-600 hover:bg-white hover:elev-1'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute inset-0 rounded-2xl -z-10"
              style={{ background: 'linear-gradient(135deg, var(--color-primary, #f97316), var(--color-primary, #ea6c0a))' }}
              aria-hidden
            />
          )}
          <span
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-xl flex-shrink-0 transition-all duration-200',
              isActive ? 'bg-white/20' : 'group-hover:bg-saffron-50'
            )}
          >
            <Icon
              className={cn(
                'w-4 h-4 flex-shrink-0 transition-all duration-200',
                isActive ? 'text-white' : 'text-slate-500 group-hover:text-saffron-500 group-hover:scale-110'
              )}
            />
          </span>
          {!collapsed && (
            <span className="text-sm truncate">{labelFor(item)}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

function OrgSwitcher({ currentOrgId, onSwitch }) {
  const [orgs, setOrgs] = useState([])
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    supabase.rpc('my_organizations').then(({ data }) => setOrgs(data ?? []))
  }, [])

  if (orgs.length <= 1) return null

  const current = orgs.find((o) => o.org_id === currentOrgId)

  return (
    <div className="mx-3 mt-2 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600 hover:bg-orange-50 hover:border-orange-200 transition-all"
      >
        <span className="truncate">{current?.org_name ?? 'Switch org'}</span>
        <LucideIcons.ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden"
          >
            {orgs.map((o) => (
              <button
                key={o.org_id}
                disabled={switching || o.org_id === currentOrgId}
                onClick={async () => {
                  setSwitching(true)
                  setOpen(false)
                  await onSwitch(o.org_id)
                  setSwitching(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-xs transition-colors',
                  o.org_id === currentOrgId
                    ? 'bg-orange-50 text-orange-700 font-semibold cursor-default'
                    : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                {o.org_name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Sidebar({ mobileOpen, onClose }) {
  const { profile, signOut, loginType, setLoginType } = useAuthStore()
  const { org, settings, nav, switchOrg } = useOrgStore()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const canMentor    = usePermission('mentorship.view_own')
  const canSeeMembers = usePermission('members.manage')

  const branding    = settings?.branding    ?? {}
  const terminology = settings?.terminology ?? {}

  const OrgIcon = branding.iconName ? (LucideIcons[branding.iconName] ?? LucideIcons.Flame) : LucideIcons.Flame

  const mainNav   = nav.filter((n) => n.key && n.route && !BOTTOM_ROUTES.includes(n.route) && n.key !== 'settings')
  const bottomNav = nav.filter((n) => n.key && n.route && (BOTTOM_ROUTES.includes(n.route) || n.key === 'settings'))

  const toggleLoginType = () => {
    const newType = loginType === 'counsellor' ? 'counsellee' : 'counsellor'
    setLoginType(newType)
    navigate('/mentorship')
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
      {/* Logo — driven by org branding */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 border-b border-slate-100">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center animate-float-slow"
          style={{ background: `var(--color-primary, #f97316)` }}
        >
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="logo" className="w-7 h-7 object-contain" />
            : <OrgIcon className="w-5 h-5 text-white" />}
        </div>
        <div className="min-w-0">
          <p className="font-extrabold text-slate-800 text-sm leading-tight tracking-tight">
            {branding.shortName ?? org?.name ?? 'Platform'}
          </p>
          {branding.tagline && (
            <p className="text-[11px] font-bold tracking-widest" style={{ color: `var(--color-primary, #f97316)` }}>
              {branding.tagline}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-auto lg:hidden p-1 rounded-lg text-slate-400 hover:text-slate-600"
        >
          <LucideIcons.X className="w-5 h-5" />
        </button>
      </div>

      {/* Org switcher — shown only when user belongs to multiple orgs */}
      <OrgSwitcher currentOrgId={org?.id} onSwitch={switchOrg} />

      {/* Nav — sourced from my_navigation() */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 scroll-container scrollbar-hide">
        {mainNav.map((item) => (
          <NavItem key={item.key} item={item} onClick={onClose} />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 pb-3 space-y-0.5 border-t border-slate-100 pt-3">
        {bottomNav.map((item) => (
          <NavItem key={item.key} item={item} onClick={onClose} />
        ))}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
        >
          <LucideIcons.LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{signingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>

      {/* Profile */}
      {profile && (
        <div className="mx-3 mb-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={profile.display_name ?? profile.spiritual_name} url={profile.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {profile.display_name ?? profile.spiritual_name}
              </p>
              <Badge variant="saffron" className="text-xs">
                {terminology.member ?? profile.role ?? 'Member'}
              </Badge>
            </div>
          </div>
          {canMentor && (
            <button
              onClick={toggleLoginType}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200 transition-all"
            >
              <LucideIcons.Users className="w-4 h-4" />
              <span>
                View as:{' '}
                <span className="font-semibold">
                  {loginType === 'counsellor'
                    ? (terminology.mentor ?? 'Mentor')
                    : (terminology.mentee ?? 'Mentee')}
                </span>
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
