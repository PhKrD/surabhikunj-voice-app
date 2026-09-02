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

// Presentational grouping of the dynamic my_navigation() result into the
// sections a parent would expect (Main / Community / Organization /
// Special). Purely cosmetic — any nav item whose key isn't listed here
// still renders, just under a generic "More" group, so a custom/future
// module enabled for an org never silently disappears.
const NAV_SECTIONS = [
  { id: 'main', label: 'Main', keys: ['trackers', 'service', 'tasks', 'cleanliness'] },
  { id: 'community', label: 'Community', keys: ['members', 'mentorship', 'events', 'announcements'] },
  { id: 'organization', label: 'Organization', keys: ['departments', 'hierarchy', 'reports', 'resources', 'broadcast'] },
  { id: 'special', label: 'Special', keys: ['parental_control'] },
]

function groupNav(items) {
  const remaining = new Set(items.map((i) => i.key))
  const groups = NAV_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((i) => section.keys.includes(i.key)),
  })).filter((g) => g.items.length > 0)
  groups.forEach((g) => g.items.forEach((i) => remaining.delete(i.key)))
  const rest = items.filter((i) => remaining.has(i.key))
  if (rest.length > 0) groups.push({ id: 'more', label: 'More', items: rest })
  return groups
}

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
          'relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group press',
          isActive
            ? 'text-white font-semibold bg-[var(--color-primary)]'
            : 'text-secondary-token hover:bg-[var(--surface-muted)] hover:text-primary-token'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 transition-all duration-150',
              isActive ? 'bg-white/20' : 'group-hover:bg-[var(--color-primary-100)] dark:group-hover:bg-[var(--color-primary-900)]'
            )}
          >
            <Icon
              className={cn(
                'w-4 h-4 flex-shrink-0 transition-all duration-150',
                isActive ? 'text-white' : 'text-muted-token group-hover:text-[var(--color-primary)]'
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
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl surface-muted border text-xs font-medium text-secondary-token hover:bg-[var(--color-primary-50)] dark:hover:bg-[var(--color-primary-900)] transition-all"
      >
        <span className="truncate">{current?.org_name ?? 'Switch org'}</span>
        <LucideIcons.ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-token" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 mt-1 surface border rounded-xl shadow-lg z-50 overflow-hidden"
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
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)] font-semibold cursor-default'
                    : 'text-secondary-token hover:bg-[var(--surface-muted)]'
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

  const dashboardItem = nav.find((n) => n.key === 'dashboard' && n.route)
  const mainNav   = nav.filter((n) => n.key && n.route && n.key !== 'dashboard' && !BOTTOM_ROUTES.includes(n.route) && n.key !== 'settings')
  const bottomNav = nav.filter((n) => n.key && n.route && (BOTTOM_ROUTES.includes(n.route) || n.key === 'settings'))
  const navGroups = groupNav(mainNav)

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
      <div
        className="flex items-center gap-3 px-4 pb-4 border-b"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}
      >
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: `var(--color-primary)` }}
        >
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="logo" className="w-7 h-7 object-contain" />
            : <OrgIcon className="w-5 h-5 text-white" />}
        </div>
        <div className="min-w-0">
          <p className="font-extrabold text-primary-token text-sm leading-tight tracking-tight">
            {branding.shortName ?? org?.name ?? 'Platform'}
          </p>
          {branding.tagline && (
            <p className="text-[11px] font-bold tracking-widest" style={{ color: `var(--color-primary)` }}>
              {branding.tagline}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-auto lg:hidden p-1 rounded-lg text-muted-token hover:text-primary-token"
        >
          <LucideIcons.X className="w-5 h-5" />
        </button>
      </div>

      {/* Org switcher — shown only when user belongs to multiple orgs */}
      <OrgSwitcher currentOrgId={org?.id} onSwitch={switchOrg} />

      {/* Nav — sourced from my_navigation(), grouped into sections */}
      <nav className="flex-1 px-3 py-4 space-y-4 scroll-container scrollbar-hide">
        {dashboardItem && <NavItem item={dashboardItem} onClick={onClose} />}
        {navGroups.map((group) => (
          <div key={group.id}>
            <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-token">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.key} item={item} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 pb-3 space-y-0.5 border-t pt-3">
        {bottomNav.map((item) => (
          <NavItem key={item.key} item={item} onClick={onClose} />
        ))}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-secondary-token hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 transition-all duration-150"
        >
          <LucideIcons.LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{signingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>

      {/* Profile */}
      {profile && (
        <div className="mx-3 mb-4 p-3 rounded-2xl surface-muted border flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={profile.display_name ?? profile.spiritual_name} url={profile.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary-token truncate">
                {profile.display_name ?? profile.spiritual_name}
              </p>
              <Badge variant="primary" className="text-xs">
                {terminology.member ?? profile.role ?? 'Member'}
              </Badge>
            </div>
          </div>
          {canMentor && (
            <button
              onClick={toggleLoginType}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl surface border text-xs font-medium text-secondary-token hover:bg-[var(--color-primary-50)] hover:text-[var(--color-primary-700)] dark:hover:bg-[var(--color-primary-900)] dark:hover:text-[var(--color-primary-200)] transition-all"
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
      <aside className="hidden lg:flex flex-col w-64 border-r surface backdrop-blur-xl h-screen sticky top-0">
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
              className="fixed inset-y-0 left-0 w-72 surface z-50 shadow-2xl lg:hidden"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
