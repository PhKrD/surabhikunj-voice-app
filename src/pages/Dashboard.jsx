import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Users, Sparkles, UtensilsCrossed, CalendarDays, ListChecks, TrendingUp, Clock, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import StatCard from '@/components/ui/StatCard'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { ROLES, ROLE_COLORS, scoreBg, formatDate, formatTime } from '@/lib/utils'

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

const SERVICE_STATUS_VARIANT = { done: 'tulasi', pending: 'yellow', missed: 'red', excused: 'blue' }
const SERVICE_STATUS_LABEL = { done: 'Done', pending: 'Pending', missed: 'Missed', excused: 'Excused' }
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'prasad_special']
const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', prasad_special: 'Special Prasad' }

export default function Dashboard() {
  const { profile } = useAuthStore()
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayISO = new Date().toISOString().split('T')[0]

  const [loading, setLoading] = useState(true)
  const [todaySadhana, setTodaySadhana] = useState(null)
  const [services, setServices] = useState([])
  const [cleaning, setCleaning] = useState({ assigned: 0, done: 0 })
  const [events, setEvents] = useState([])
  const [recent, setRecent] = useState([])
  const [meals, setMeals] = useState([])

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const nowISO = new Date().toISOString()
    const [sadhanaRes, servicesRes, logsRes, assignRes, eventsRes, recentRes, mealsRes] = await Promise.all([
      supabase.from('sadhana_reports').select('score, report_date').eq('profile_id', profile.id).eq('report_date', todayISO).maybeSingle(),
      supabase.from('service_allocations').select('id, status, service_time, service:service_id(name)').eq('profile_id', profile.id).eq('service_date', todayISO).order('service_time', { ascending: true }),
      supabase.from('cleaning_logs').select('id, status').eq('profile_id', profile.id).eq('log_date', todayISO),
      supabase.from('cleaning_assignments').select('id').eq('profile_id', profile.id),
      supabase.from('events').select('id, title, start_datetime, venue, event_type, is_mandatory').eq('voice_id', profile.voice_id).eq('is_active', true).gte('start_datetime', nowISO).order('start_datetime', { ascending: true }).limit(4),
      supabase.from('sadhana_reports').select('id, report_date, score, japa_rounds, mangal_arti, morning_class').eq('profile_id', profile.id).order('report_date', { ascending: false }).limit(5),
      supabase.from('meal_plans').select('id, meal_type, menu_items, notes, is_special').eq('voice_id', profile.voice_id).eq('plan_date', todayISO),
    ])
    setTodaySadhana(sadhanaRes.data ?? null)
    setServices(servicesRes.data ?? [])
    const logs = logsRes.data ?? []
    setCleaning({ assigned: (assignRes.data ?? []).length, done: logs.filter((l) => l.status === 'done').length })
    setEvents(eventsRes.data ?? [])
    setRecent(recentRes.data ?? [])
    setMeals(mealsRes.data ?? [])
    setLoading(false)
  }, [profile, todayISO])

  useEffect(() => {
    const id = setTimeout(() => { load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const servicesDone = services.filter((s) => s.status === 'done').length
  const sadhanaValue = todaySadhana?.score != null ? Math.round(todaySadhana.score) : null

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
        <StatCard label="Sadhana Today" value={sadhanaValue != null ? sadhanaValue : '—'} icon={BookOpen} color="lotus" />
        <StatCard label="Today's Services" value={services.length ? `${servicesDone}/${services.length}` : '—'} icon={ListChecks} color="saffron" />
        <StatCard label="Cleanliness" value={cleaning.assigned ? `${cleaning.done}/${cleaning.assigned}` : '—'} icon={Sparkles} color="tulasi" />
        <StatCard label="Upcoming Events" value={events.length} icon={CalendarDays} color="blue" />
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

      {/* Today's Services */}
      {services.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">Today's Services</h3>
                <Link to="/services" className="text-sm text-saffron-600 hover:text-saffron-700 font-medium">
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              <div className="divide-y divide-slate-50">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <ListChecks className="w-4 h-4 text-saffron-500 flex-shrink-0" />
                      <span className="text-sm text-slate-700 truncate">{s.service?.name ?? 'Service'}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {s.service_time && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="w-3 h-3" />
                          {formatTime(s.service_time)}
                        </span>
                      )}
                      <Badge variant={SERVICE_STATUS_VARIANT[s.status] ?? 'default'}>
                        {SERVICE_STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Today's Prasadam */}
      {meals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">Today's Prasadam</h3>
                <Link to="/kitchen" className="text-sm text-saffron-600 hover:text-saffron-700 font-medium">
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              <div className="divide-y divide-slate-50">
                {[...meals].sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type)).map((m) => (
                  <div key={m.id} className="flex items-start gap-3 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <UtensilsCrossed className="w-4 h-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-700">{MEAL_LABEL[m.meal_type] ?? m.meal_type}</p>
                        {m.is_special && <Badge variant="saffron">Special</Badge>}
                      </div>
                      {Array.isArray(m.menu_items) && m.menu_items.length > 0 && (
                        <p className="text-sm text-slate-500 mt-0.5">{m.menu_items.join(', ')}</p>
                      )}
                      {m.notes && <p className="text-xs text-slate-400 mt-0.5">{m.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Upcoming Events */}
      {events.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">Upcoming Events</h3>
                <Link to="/events" className="text-sm text-saffron-600 hover:text-saffron-700 font-medium">
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              <div className="divide-y divide-slate-50">
                {events.map((e) => (
                  <div key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="flex items-start gap-2 min-w-0">
                      <CalendarDays className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{e.title}</p>
                        {e.venue && (
                          <span className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {e.venue}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs text-slate-500">{format(new Date(e.start_datetime), 'dd MMM, h:mm a')}</span>
                      {e.is_mandatory && <Badge variant="red">Mandatory</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Recent Sadhana Reports */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
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
            {loading ? (
              <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>
            ) : recent.length === 0 ? (
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
            ) : (
              <div className="divide-y divide-slate-50">
                {recent.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700">{formatDate(r.report_date)}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-xs text-slate-400">{r.japa_rounds ?? 0} rounds</span>
                        {r.mangal_arti && <Badge variant="tulasi">MA ✓</Badge>}
                        {r.morning_class && <Badge variant="blue">MC ✓</Badge>}
                      </div>
                    </div>
                    <div className={`px-3 py-1.5 rounded-xl text-sm font-bold ${scoreBg(r.score ?? 0)}`}>
                      {(r.score ?? 0).toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </motion.div>
    </div>
  )
}
