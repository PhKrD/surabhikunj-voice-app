import { motion } from 'framer-motion'
import { BookOpen, Users, Sparkles, UtensilsCrossed, CalendarDays, ListChecks, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import useAuthStore from '@/store/authStore'
import StatCard from '@/components/ui/StatCard'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { ROLES, ROLE_COLORS } from '@/lib/utils'

const modules = [
  { label: 'Sadhana', icon: BookOpen, to: '/sadhana', color: 'bg-lotus-50 border-lotus-100 text-lotus-600', desc: 'Track daily spiritual practices' },
  { label: 'Counsellor', icon: Users, to: '/counsellor', color: 'bg-blue-50 border-blue-100 text-blue-600', desc: 'Manage counsellee relationships' },
  { label: 'Services', icon: ListChecks, to: '/services', color: 'bg-saffron-50 border-saffron-100 text-saffron-600', desc: 'View & manage service assignments' },
  { label: 'Cleanliness', icon: Sparkles, to: '/cleanliness', color: 'bg-tulasi-50 border-tulasi-100 text-tulasi-600', desc: 'Daily cleaning assignments' },
  { label: 'Kitchen', icon: UtensilsCrossed, to: '/kitchen', color: 'bg-orange-50 border-orange-100 text-orange-600', desc: 'Meal plans & menus' },
  { label: 'Events', icon: CalendarDays, to: '/events', color: 'bg-indigo-50 border-indigo-100 text-indigo-600', desc: 'Programs & festivals' },
]

const todayQuote = {
  text: 'One who has taken birth in this human form of life, if he does not utilize this opportunity for self-realization, is certainly the killer of his own self.',
  source: 'Śrīmad-Bhāgavatam 11.20.17',
}

export default function Dashboard() {
  const { profile } = useAuthStore()
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Hare Krishna, {profile?.spiritual_name?.split(' ')[0] ?? 'Prabhuji'} 🙏
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">{today}</p>
        </div>
        {profile && (
          <Badge className={ROLE_COLORS[profile.role]}>
            {ROLES[profile.role]}
          </Badge>
        )}
      </motion.div>

      {/* Daily Quote */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gradient-to-r from-saffron-500 to-saffron-600 rounded-2xl p-5 text-white shadow-lg shadow-saffron-200"
      >
        <p className="text-sm font-medium opacity-80 mb-1">Verse of the Day</p>
        <p className="text-base font-medium leading-relaxed italic">"{todayQuote.text}"</p>
        <p className="text-xs opacity-70 mt-2">— {todayQuote.source}</p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard label="Sadhana Score" value="—" icon={BookOpen} color="lotus" />
        <StatCard label="Today's Services" value="—" icon={ListChecks} color="saffron" />
        <StatCard label="Cleanliness" value="—" icon={Sparkles} color="tulasi" />
        <StatCard label="Upcoming Events" value="—" icon={CalendarDays} color="blue" />
      </motion.div>

      {/* Quick Access Modules */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h3 className="text-base font-semibold text-slate-700 mb-3">Quick Access</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {modules.map((mod) => (
            <Link
              key={mod.to}
              to={mod.to}
              className="group block"
            >
              <div className={`border rounded-2xl p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${mod.color}`}>
                <mod.icon className="w-7 h-7 mb-2" />
                <p className="font-semibold text-sm text-slate-800">{mod.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{mod.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </motion.div>

      {/* Recent Activity placeholder */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">Recent Sadhana Reports</h3>
              <Link to="/sadhana" className="text-sm text-saffron-600 hover:text-saffron-700 font-medium">
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col items-center py-8 text-slate-400">
              <TrendingUp className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No reports yet. Submit your first sadhana report!</p>
              <Link
                to="/sadhana"
                className="mt-3 text-sm text-saffron-600 hover:text-saffron-700 font-medium"
              >
                Submit Report →
              </Link>
            </div>
          </CardBody>
        </Card>
      </motion.div>
    </div>
  )
}
