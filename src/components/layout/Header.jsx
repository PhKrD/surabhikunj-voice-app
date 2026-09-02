import { useEffect, useMemo, useState, useRef } from 'react'
import { Menu, Bell, Search, Moon, Sun } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useThemeStore from '@/store/themeStore'
import Avatar from '@/components/ui/Avatar'

function NavSearch({ nav, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
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
    <div ref={boxRef} className="relative hidden sm:block w-full max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search anything..."
        className="!pl-9 !py-2 !rounded-xl !text-sm"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 surface border rounded-xl shadow-lg z-50 overflow-hidden py-1">
          {results.map((r) => (
            <button
              key={r.key}
              onClick={() => go(r.route)}
              className="w-full text-left px-3 py-2 text-sm text-secondary-token hover:bg-[var(--surface-muted)] hover:text-primary-token transition-colors"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Header({ onMenuClick }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { org, nav } = useOrgStore()
  const { isDark, toggle } = useThemeStore()
  const profileId = profile?.id

  const routeLabel = nav.find(
    (n) => n.route === location.pathname || location.pathname.startsWith(n.route + '/')
  )?.label
  const label = routeLabel ?? (location.pathname.startsWith('/residents/') ? 'Resident Profile' : (org?.name ?? 'Platform'))

  const { data: unread = 0, refetch } = useCachedQuery(
    profileId ? `notif:unread:${profileId}` : null,
    async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('is_read', false)
      return count ?? 0
    }
  )

  useEffect(() => {
    if (!profileId) return undefined
    const channel = supabase
      .channel(`notif-bell-${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
        () => refetch()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profileId, refetch])

  return (
    <header
      className="sticky top-0 z-30 bg-[var(--surface)]/80 border-[var(--border-color)] backdrop-blur-xl border-b px-4 py-3 flex items-center gap-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-xl text-secondary-token hover:bg-[var(--surface-muted)] transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <h1 className="text-lg sm:text-xl font-extrabold tracking-tight truncate text-primary-token flex-shrink-0">{label}</h1>

      <div className="flex-1 flex justify-center">
        <NavSearch nav={nav} onNavigate={navigate} />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={toggle}
          className="p-2.5 rounded-2xl text-secondary-token hover:bg-[var(--surface-muted)] transition-all"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button
          onClick={() => navigate('/notifications')}
          className="relative p-2.5 rounded-2xl text-secondary-token hover:bg-[var(--surface-muted)] transition-all"
          title="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-[var(--color-danger)] rounded-full ring-2 ring-[var(--surface)]">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        {profile && (
          <Avatar
            name={profile.display_name ?? profile.spiritual_name ?? profile.email}
            url={profile.avatar_url}
            size="sm"
            className="cursor-pointer ring-2 ring-[var(--color-primary-200)] ring-offset-1 ring-offset-[var(--surface)]"
            onClick={() => navigate('/settings')}
          />
        )}
      </div>
    </header>
  )
}
