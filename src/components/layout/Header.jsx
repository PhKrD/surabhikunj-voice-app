import { useEffect } from 'react'
import { Menu, Bell } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import useAuthStore from '@/store/authStore'
import Avatar from '@/components/ui/Avatar'

const routeLabels = {
  '/': 'Dashboard',
  '/residents': 'Residents',
  '/sadhana': 'Sadhana Tracker',
  '/counsellor': 'Counsellor',
  '/departments': 'Departments',
  '/services': 'Services (IM)',
  '/cleanliness': 'Cleanliness',
  '/kitchen': 'Kitchen',
  '/events': 'Events & Festivals',
  '/hierarchy': 'Org Structure',
  '/announcements': 'Announcements',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
}

export default function Header({ onMenuClick }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const profileId = profile?.id
  const label =
    routeLabels[location.pathname] ??
    (location.pathname.startsWith('/residents/') ? 'Resident Profile' : 'SurabhiKunj VOICE')

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
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-sm border-b border-slate-100 px-4 py-3 flex items-center gap-3">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <h1 className="flex-1 text-lg font-semibold text-slate-800 truncate">{label}</h1>

      <div className="flex items-center gap-2">
        <button 
          onClick={() => navigate('/notifications')}
          className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
          title="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-saffron-500 rounded-full">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        {profile && (
          <Avatar
            name={profile.spiritual_name}
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
