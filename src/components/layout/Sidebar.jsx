import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { ChevronsUpDown, LogOut, Moon, Sun, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getIcon } from '@/lib/icons'
import { registerBackHandler } from '@/lib/backButton'
import { APP_VERSION } from '@/lib/appVersion'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useThemeStore from '@/store/themeStore'
import useConfigStore from '@/store/configStore'
import { confirm } from '@/store/dialogStore'
import Avatar from '@/components/ui/Avatar'
import DynamicIcon from '@/components/ui/DynamicIcon'
import usePermission from '@/hooks/usePermission'
import { supabase } from '@/lib/supabase'
import { useDeviceState } from '@/store/childDeviceState'

const BOTTOM_ROUTES = ['/notifications', '/settings']

// Presentational grouping of the dynamic my_navigation() result. Purely
// cosmetic — any nav item whose key isn't listed still renders under "More",
// so a custom/future module enabled for an org never silently disappears.
const NAV_SECTIONS = [
  { id: 'main', label: 'Daily', keys: ['trackers', 'service', 'tasks', 'cleanliness'] },
  { id: 'community', label: 'Community', keys: ['members', 'mentorship', 'events', 'announcements'] },
  { id: 'organization', label: 'Organization', keys: ['departments', 'hierarchy', 'reports', 'resources', 'broadcast'] },
  { id: 'special', label: 'Family', keys: ['parental_control'] },
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

function labelFor(item) {
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  const key = typeof item.key === 'string' ? item.key.trim() : ''
  return label || key || 'Menu'
}

function NavItem({ item, onClick }) {
  return (
    <NavLink
      to={item.route}
      end={item.route === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 h-11 px-3 rounded-[var(--radius-md)] text-sm transition-colors duration-150',
          isActive
            ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)] font-semibold'
            : 'text-secondary-token font-medium hover:bg-[var(--surface-muted)] hover:text-primary-token',
        )
      }
    >
      {({ isActive }) => (
        <>
          <DynamicIcon
            name={item.icon}
            className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-[var(--color-primary)]' : 'text-muted-token')}
            aria-hidden="true"
          />
          <span className="truncate">{labelFor(item)}</span>
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
    <div className="mx-3 mt-3 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="w-full flex items-center justify-between h-10 px-3 rounded-[var(--radius-md)] bg-[var(--surface-muted)] text-sm font-medium text-secondary-token"
        aria-expanded={open}
      >
        <span className="truncate">{current?.org_name ?? 'Switch organization'}</span>
        <ChevronsUpDown className="w-4 h-4 flex-shrink-0 text-muted-token" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 mt-1 bg-[var(--surface-elevated)] border border-[var(--border-color)] rounded-[var(--radius-md)] shadow-[var(--shadow-3)] z-50 overflow-hidden py-1"
          >
            {orgs.map((o) => (
              <button
                key={o.org_id}
                disabled={switching || o.org_id === currentOrgId}
                onClick={async () => {
                  setSwitching(true)
                  setOpen(false)
                  try {
                    await onSwitch(o.org_id)
                  } finally {
                    setSwitching(false)
                  }
                }}
                className={cn(
                  'w-full text-left px-3.5 py-2.5 text-sm',
                  o.org_id === currentOrgId
                    ? 'text-[var(--color-primary-strong)] font-semibold cursor-default'
                    : 'text-secondary-token hover:bg-[var(--surface-muted)]',
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
  const { isDark, toggle } = useThemeStore()
  const native = useConfigStore((s) => s.native)
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  // This device is ALSO paired as a supervised child device — show a
  // "Family" entry point alongside the rest of the org app.
  const familyEnrolled = useDeviceState((s) => s.enrolled)
  const familyIsOrgMember = useDeviceState((s) => s.isOrgMember)
  const showFamilyNav = familyEnrolled && familyIsOrgMember
  const familyItem = { key: 'family', label: 'Family', icon: 'Baby', route: '/family' }

  const canMentor = usePermission('mentorship.view_own')

  const branding = settings?.branding ?? {}
  const terminology = settings?.terminology ?? {}

  const dashboardItem = nav.find((n) => n.key === 'dashboard' && n.route)
  const mainNav = nav.filter((n) => n.key && n.route && n.key !== 'dashboard' && !BOTTOM_ROUTES.includes(n.route) && n.key !== 'settings')
  const bottomNav = nav.filter((n) => n.key && n.route && (BOTTOM_ROUTES.includes(n.route) || n.key === 'settings'))
  const navGroups = groupNav(mainNav)

  // Android back closes the drawer before doing anything else.
  useEffect(() => {
    if (!mobileOpen) return undefined
    return registerBackHandler(() => {
      onClose?.()
      return true
    })
  }, [mobileOpen, onClose])

  const toggleLoginType = () => {
    setLoginType(loginType === 'counsellor' ? 'counsellee' : 'counsellor')
    navigate('/mentorship')
    onClose?.()
  }

  const handleSignOut = async () => {
    if (signingOut) return
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You’ll need your email and password to sign in again on this device.',
      confirmLabel: 'Sign out',
    })
    if (!ok) return
    setSigningOut(true)
    onClose?.()
    await signOut()
    setSigningOut(false)
    navigate('/login', { replace: true })
  }

  const content = (
    <div className="flex flex-col h-full">
      {/* Brand — driven by org branding */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}>
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="w-7 h-7 object-contain" />
          ) : (
            <DynamicIcon name={branding.iconName} fallback={getIcon('Flame')} className="w-5 h-5 text-white" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-primary-token text-[0.9375rem] leading-tight truncate">
            {branding.shortName ?? org?.name ?? 'VOICE'}
          </p>
          {branding.tagline && <p className="text-overline !text-[var(--color-primary)] truncate">{branding.tagline}</p>}
        </div>
        <button
          onClick={onClose}
          className="lg:hidden w-10 h-10 -mr-1 flex items-center justify-center rounded-full text-muted-token hover:bg-[var(--surface-muted)]"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Profile card — phones only (desktop has it in the header) */}
      {profile && (
        <button
          onClick={() => { navigate('/settings'); onClose?.() }}
          className="lg:hidden mx-3 mb-1 p-3 rounded-[var(--radius-lg)] bg-[var(--surface-muted)] flex items-center gap-3 text-left"
        >
          <Avatar name={profile.display_name} url={profile.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-token truncate">{profile.display_name}</p>
            <p className="text-caption truncate">{profile.email}</p>
          </div>
        </button>
      )}

      <OrgSwitcher currentOrgId={org?.id} onSwitch={switchOrg} />

      {/* Nav — sourced from my_navigation(), grouped into sections */}
      <nav aria-label="All sections" className="flex-1 px-3 py-3 space-y-5 scroll-container scrollbar-hide">
        <div className="space-y-0.5">
          {dashboardItem && <NavItem item={dashboardItem} onClick={onClose} />}
          {showFamilyNav && <NavItem item={familyItem} onClick={onClose} />}
        </div>
        {navGroups.map((group) => (
          <div key={group.id}>
            <p className="px-3 mb-1.5 text-overline">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.key} item={item} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 pt-3 pb-3 space-y-0.5 border-t border-[var(--border-color)]">
        {bottomNav.map((item) => (
          <NavItem key={item.key} item={item} onClick={onClose} />
        ))}
        {canMentor && (
          <button
            onClick={toggleLoginType}
            className="w-full flex items-center gap-3 h-11 px-3 rounded-[var(--radius-md)] text-sm font-medium text-secondary-token hover:bg-[var(--surface-muted)]"
          >
            <Users className="w-5 h-5 text-muted-token" aria-hidden="true" />
            <span className="truncate">
              Viewing as{' '}
              <span className="font-semibold text-primary-token">
                {loginType === 'counsellor' ? (terminology.mentor ?? 'Mentor') : (terminology.mentee ?? 'Mentee')}
              </span>
            </span>
          </button>
        )}
        <button
          onClick={toggle}
          className="lg:hidden w-full flex items-center gap-3 h-11 px-3 rounded-[var(--radius-md)] text-sm font-medium text-secondary-token hover:bg-[var(--surface-muted)]"
        >
          {isDark ? <Sun className="w-5 h-5 text-muted-token" /> : <Moon className="w-5 h-5 text-muted-token" />}
          {isDark ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-3 h-11 px-3 rounded-[var(--radius-md)] text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <p className="px-3 pt-2 text-[0.6875rem] text-muted-token tabular">
          Version {APP_VERSION}{native.versionCode ? ` · build ${native.versionCode}` : ''}
        </p>
      </div>
      <div className="lg:hidden pb-safe" />
    </div>
  )

  return (
    <>
      <aside className="hidden lg:flex flex-col w-72 border-r border-[var(--border-color)] bg-[var(--surface)] h-svh sticky top-0">
        {content}
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50 lg:hidden"
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 340 }}
              className="fixed inset-y-0 left-0 w-[86%] max-w-[20rem] bg-[var(--surface)] z-50 shadow-[var(--shadow-4)] lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
