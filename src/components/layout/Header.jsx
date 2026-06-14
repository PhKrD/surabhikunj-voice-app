import { Menu, Bell } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
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
  '/notifications': 'Notifications',
  '/settings': 'Settings',
}

export default function Header({ onMenuClick }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const label = routeLabels[location.pathname] ?? 'SurabhiKunj VOICE'

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
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-saffron-500 rounded-full" />
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
