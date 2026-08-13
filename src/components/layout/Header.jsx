import { useEffect } from 'react'
import { Menu, Bell } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Avatar from '@/components/ui/Avatar'


export default function Header({ onMenuClick }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { org, nav } = useOrgStore()
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
    <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-white/60 px-4 py-3 flex items-center gap-3">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <h1 className="flex-1 text-xl font-extrabold tracking-tight truncate bg-gradient-to-r from-slate-800 to-slate-500 bg-clip-text text-transparent">{label}</h1>

      <div className="flex items-center gap-2">
        <button 
          onClick={() => navigate('/notifications')}
          className="relative p-2.5 rounded-2xl text-slate-500 hover:bg-white hover:shadow-sm transition-all"
          title="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center text-[10px] font-bold text-white grad-rose rounded-full ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        {profile && (
          <Avatar
            name={profile.display_name ?? profile.spiritual_name ?? profile.email}
            url={profile.avatar_url}
            size="sm"
            className="cursor-pointer ring-2 ring-saffron-200 ring-offset-1"
            onClick={() => navigate('/settings')}
          />
        )}
      </div>
    </header>
  )
}
