import { useEffect, useMemo, useState, useRef } from 'react'
import { Bell, Search, Moon, Sun, ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import { isRootPath } from '@/lib/backButton'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useThemeStore from '@/store/themeStore'
import Avatar from '@/components/ui/Avatar'

function NavSearch({ nav, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return nav.filter((n) => n.route && (n.label ?? n.key ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [nav, query])

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const go = (route) => {
    setOpen(false)
    setQuery('')
    onNavigate(route)
  }

  return (
    <div ref={boxRef} className="relative hidden lg:block w-full max-w-xs">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token pointer-events-none" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].route) }}
        placeholder="Jump to…"
        aria-label="Jump to a section"
        className="!min-h-0 !h-10 !pl-10 !py-0 !rounded-full !text-sm !bg-[var(--surface-muted)] !border-transparent"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-2 bg-[var(--surface-elevated)] border border-[var(--border-color)] rounded-[var(--radius-md)] shadow-[var(--shadow-3)] z-50 overflow-hidden py-1">
          {results.map((r) => (
            <button
              key={r.key}
              onClick={() => go(r.route)}
              className="w-full text-left px-3.5 py-2.5 text-sm text-secondary-token hover:bg-[var(--surface-muted)] hover:text-primary-token"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const ROUTE_TITLES = [
  [/^\/residents\/[^/]+/, 'Profile'],
  [/^\/parental-control\/[^/]+/, 'Child'],
  [/^\/notifications/, 'Notifications'],
  [/^\/settings/, 'Settings'],
]

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { org, nav } = useOrgStore()
  const { isDark, toggle } = useThemeStore()
  const profileId = profile?.id
  const atRoot = isRootPath(location.pathname)

  const routeLabel = nav.find(
    (n) => n.route && n.route !== '/' && (n.route === location.pathname || location.pathname.startsWith(n.route + '/')),
  )?.label
  const fallback = ROUTE_TITLES.find(([re]) => re.test(location.pathname))?.[1]
  const title = atRoot ? (org?.name ?? 'Home') : (routeLabel ?? fallback ?? org?.name ?? '')

  const { data: unread = 0, refetch } = useCachedQuery(
    profileId ? `notif:unread:${profileId}` : null,
    async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('is_read', false)
      return count ?? 0
    },
  )

  useEffect(() => {
    if (!profileId) return undefined
    const channel = supabase
      .channel(`notif-bell-${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
        () => refetch(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profileId, refetch])

  // A nested page (e.g. a profile opened from a list) gets a back arrow on
  // phones, which have no persistent sidebar to navigate with.
  const showBack = !atRoot && location.pathname.split('/').filter(Boolean).length > 1

  return (
    <header
      className="sticky top-0 z-30 bg-[var(--surface-app)]/90 backdrop-blur-md border-b border-[var(--border-color)] lg:bg-[var(--surface)]/90"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="h-14 lg:h-16 px-2 lg:px-8 flex items-center gap-1 lg:gap-4 max-w-full">
        {showBack ? (
          <button
            onClick={() => navigate(-1)}
            className="lg:hidden w-11 h-11 flex items-center justify-center rounded-full text-secondary-token hover:bg-[var(--surface-muted)]"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <span className="lg:hidden w-2" aria-hidden="true" />
        )}

        <h1 className="flex-1 min-w-0 text-heading lg:text-title text-primary-token truncate">{title}</h1>

        <NavSearch nav={nav} onNavigate={navigate} />

        <div className="flex items-center gap-0.5 lg:gap-1.5">
          <button
            onClick={toggle}
            className="hidden lg:flex w-10 h-10 items-center justify-center rounded-full text-secondary-token hover:bg-[var(--surface-muted)]"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={() => navigate('/notifications')}
            className="relative w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center rounded-full text-secondary-token hover:bg-[var(--surface-muted)]"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <Bell className="w-[22px] h-[22px] lg:w-5 lg:h-5" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[1.125rem] h-[1.125rem] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-[var(--color-danger)] rounded-full ring-2 ring-[var(--surface-app)] lg:ring-[var(--surface)] tabular">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          {profile && (
            <button
              onClick={() => navigate('/settings')}
              className="w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center rounded-full"
              aria-label="Your profile and settings"
            >
              <Avatar name={profile.display_name ?? profile.email} url={profile.avatar_url} size="sm" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
