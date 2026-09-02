import { motion } from 'framer-motion'
import { BookOpen, UtensilsCrossed, CalendarDays, ListChecks, TrendingUp, Clock, MapPin, Megaphone, MessageCircle, AlertCircle, RefreshCw, CheckCircle2, Users, Building2, GitBranch, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import StatCard from '@/components/ui/StatCard'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import { scoreBg, formatDate, formatTime } from '@/lib/utils'

const FALLBACK_QUOTE = {
  label: 'Verse of the Day',
  text: 'One who has taken birth in this human form of life, if he does not utilize this opportunity for self-realization, is certainly the killer of his own self.',
  source: 'Śrīmad-Bhāgavatam 11.20.17',
}

const TASK_STATUS_VARIANT = { done: 'tulasi', pending: 'yellow', missed: 'red', excused: 'blue', partial: 'yellow', verified: 'blue' }

const QUICK_ICON_MAP = {
  trackers: BookOpen, mentorship: MessageCircle, tasks: ListChecks,
  resources: UtensilsCrossed, events: CalendarDays, departments: Building2,
  announcements: Megaphone, hierarchy: GitBranch, members: Users,
  reports: BarChart3,
}

export default function Dashboard() {
  const { profile, profileLoading, profileError, user, fetchProfile } = useAuthStore()
  const { org, nav, t, settings } = useOrgStore()
  const orgId = org?.id ?? profile?.org_id
  const quote = settings?.branding?.dailyQuote ?? FALLBACK_QUOTE

  const quickNav = nav.filter((n) => !['settings', 'notifications', 'dashboard'].includes(n.key)).slice(0, 6)

  const greeting = t('greeting', 'Welcome')
  const displayName = profile?.display_name ?? profile?.spiritual_name ?? profile?.legal_name ?? ''
  const firstName = displayName.split(' ')[0] || t('member', 'Member')
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayISO = new Date().toISOString().split('T')[0]

  const { data, loading: queryLoading } = useCachedQuery(
    profile && orgId ? `dashboard:${profile.id}:${orgId}:${todayISO}` : null,
    async () => {
      const nowISO = new Date().toISOString()

      // Fetch from new primitive tables; gracefully returns empty on pre-migration DB
      const [
        trackerEntriesRes,
        taskAssignRes,
        taskLogRes,
        resourcePlansRes,
        eventsRes,
        recentTrackerRes,
        announcementsRes,
        mentorRes,
      ] = await Promise.all([
        // Today's tracker entries (all trackers)
        supabase.from('tracker_entries')
          .select('id, score, tracker_definitions(id, name, color)')
          .eq('user_id', profile.id)
          .eq('org_id', orgId)
          .eq('period_date', todayISO),

        // Today's task assignments
        supabase.from('task_assignments')
          .select('id, task_time, task_templates(name)')
          .eq('user_id', profile.id)
          .eq('task_date', todayISO)
          .order('task_time'),

        // Today's task logs (for status)
        supabase.from('task_logs')
          .select('assignment_id, status')
          .eq('user_id', profile.id)
          .eq('log_date', todayISO),

        // Today's resource plans
        supabase.from('resource_plans')
          .select('id, resource_types(name, icon, color), resource_plan_items(name, quantity, sort_order)')
          .eq('org_id', orgId)
          .eq('plan_date', todayISO),

        // Upcoming events
        supabase.from('events')
          .select('id, title, start_datetime, venue, event_type, is_mandatory')
          .eq('org_id', orgId)
          .eq('is_active', true)
          .gte('start_datetime', nowISO)
          .order('start_datetime', { ascending: true })
          .limit(4),

        // Recent tracker entries (across all trackers, last 5)
        supabase.from('tracker_entries')
          .select('id, period_date, score, tracker_definitions(name, color)')
          .eq('user_id', profile.id)
          .eq('org_id', orgId)
          .order('period_date', { ascending: false })
          .limit(5),

        // Announcements
        supabase.from('announcements')
          .select('id, title, body, is_pinned, created_at')
          .eq('org_id', orgId)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(2),

        // Mentor via RPC
        supabase.rpc('my_mentor'),
      ])

      const taskLogMap = {}
      for (const l of taskLogRes.data ?? []) taskLogMap[l.assignment_id] = l.status

      const tasks = (taskAssignRes.data ?? []).map((a) => ({
        ...a,
        status: taskLogMap[a.id] ?? 'pending',
      }))

      // Score: average of today's tracker entries that have a score
      const scoredEntries = (trackerEntriesRes.data ?? []).filter((e) => e.score != null)
      const avgScore = scoredEntries.length
        ? Math.round(scoredEntries.reduce((s, e) => s + e.score, 0) / scoredEntries.length)
        : null

      return {
        trackerScore: avgScore,
        trackerCount: (trackerEntriesRes.data ?? []).length,
        tasks,
        resourcePlans: resourcePlansRes.data ?? [],
        events: eventsRes.data ?? [],
        recentEntries: recentTrackerRes.data ?? [],
        announcements: announcementsRes.data ?? [],
        mentor: (mentorRes.data ?? [])[0] ?? null,
      }
    }
  )

  const {
    trackerScore = null,
    trackerCount = 0,
    tasks = [],
    resourcePlans = [],
    events = [],
    recentEntries = [],
    announcements = [],
    mentor = null,
  } = data ?? {}

  const loading = queryLoading
  const tasksDone = tasks.filter((t) => t.status === 'done' || t.status === 'verified').length

  // Profile failed to load → show recoverable error instead of hanging forever
  if (profileError && !profile) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Card>
          <CardBody className="text-center py-10">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <h3 className="font-semibold text-primary-token mb-1">Could not load your profile</h3>
            <p className="text-sm text-secondary-token mb-4">{profileError}</p>
            <Button icon={RefreshCw} onClick={() => user?.id && fetchProfile(user.id)} loading={profileLoading}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  // First-time profile fetch → show skeleton (not a stuck spinner)
  if (!profile) {
    return (
      <div className="max-w-6xl mx-auto space-y-4 animate-pulse">
        <div className="h-20 surface-muted rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-24 surface-muted rounded-2xl" />
          <div className="h-24 surface-muted rounded-2xl" />
          <div className="h-24 surface-muted rounded-2xl" />
          <div className="h-24 surface-muted rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <div>
          <h2 className="text-2xl font-bold text-primary-token">
            {greeting}, {firstName} <span aria-hidden>👋</span>
          </h2>
          <p className="text-sm text-secondary-token mt-0.5">{today}</p>
        </div>
        {profile && (
          <Badge variant="primary">
            {profile.role ?? t('member', 'Member')}
          </Badge>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Verse of the Day — quiet spiritual accent, not a huge banner */}
          {quote && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden rounded-2xl p-5 text-white"
              style={{ background: `linear-gradient(135deg, var(--color-primary-700), var(--color-primary-500))` }}
            >
              <div className="flex items-start justify-between gap-3 relative">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-2">{quote.label ?? 'Verse of the Day'}</p>
                  <p className="text-base font-medium leading-relaxed italic">"{quote.text}"</p>
                  {quote.source && (
                    <p className="text-xs text-white/75 mt-3 font-semibold">— {quote.source}</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3"
          >
            <StatCard
              label={t('tracker', 'Tracker') + ' Today'}
              value={trackerScore != null ? `${trackerScore}%` : trackerCount > 0 ? '✓' : '—'}
              progress={trackerScore != null ? trackerScore : undefined}
              icon={BookOpen}
              color="lotus"
            />
            <StatCard
              label={t('tasks', 'Tasks') + ' Today'}
              value={tasks.length ? `${tasksDone}/${tasks.length}` : '—'}
              icon={ListChecks}
              color="saffron"
            />
            <StatCard
              label="Resources Today"
              value={resourcePlans.length || '—'}
              icon={UtensilsCrossed}
              color="amber"
            />
            <StatCard label="Upcoming Events" value={events.length || '—'} icon={CalendarDays} color="blue" />
          </motion.div>

          {/* Quick Access Modules — driven by my_navigation() */}
          {quickNav.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h3 className="text-sm font-semibold text-secondary-token mb-2.5">Quick Access</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {quickNav.map((mod) => {
                  const ModIcon = QUICK_ICON_MAP[mod.key] ?? BookOpen
                  return (
                    <Link key={mod.route} to={mod.route} className="group block">
                      <div className="flex items-center gap-3 rounded-xl p-3 surface border hover:border-[var(--color-primary-200)] hover:bg-[var(--color-primary-50)] dark:hover:bg-[var(--color-primary-900)] transition-colors">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-900)] flex-shrink-0">
                          <ModIcon className="w-4.5 h-4.5 text-[var(--color-primary-600)] dark:text-[var(--color-primary-300)]" />
                        </div>
                        <p className="font-semibold text-sm text-primary-token truncate">{mod.label || mod.key}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* Today's Tasks */}
          {tasks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-primary-token">Today's {t('tasks', 'Tasks')}</h3>
                    <Link to="/tasks" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      View all →
                    </Link>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="divide-y divide-[var(--border-color)]">
                    {tasks.map((task) => (
                      <div key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {task.status === 'done' || task.status === 'verified'
                            ? <CheckCircle2 className="w-4 h-4 text-tulasi-600 flex-shrink-0" />
                            : <ListChecks className="w-4 h-4 text-saffron-400 flex-shrink-0" />
                          }
                          <span className="text-sm text-primary-token truncate">
                            {task.task_templates?.name ?? 'Task'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {task.task_time && (
                            <span className="flex items-center gap-1 text-xs text-muted-token">
                              <Clock className="w-3 h-3" />
                              {formatTime(task.task_time)}
                            </span>
                          )}
                          <Badge variant={TASK_STATUS_VARIANT[task.status] ?? 'default'}>
                            {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {/* Today's Resources */}
          {resourcePlans.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-primary-token">Today's Resources</h3>
                    <Link to="/resources" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      View all →
                    </Link>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="divide-y divide-[var(--border-color)]">
                    {resourcePlans.map((plan) => (
                      <div key={plan.id} className="flex items-start gap-3 py-2.5">
                        <div className="w-8 h-8 rounded-lg bg-saffron-50 dark:bg-saffron-900/30 flex items-center justify-center flex-shrink-0">
                          <UtensilsCrossed className="w-4 h-4 text-saffron-600 dark:text-saffron-300" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-primary-token">
                            {plan.resource_types?.name ?? 'Resource'}
                          </p>
                          {(plan.resource_plan_items ?? []).length > 0 && (
                            <p className="text-sm text-secondary-token mt-0.5">
                              {[...plan.resource_plan_items]
                                .sort((a, b) => a.sort_order - b.sort_order)
                                .map((i) => i.name)
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {/* Recent Activity — recent tracker entries */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-primary-token">Recent Activity</h3>
                  <Link to="/trackers" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    View all →
                  </Link>
                </div>
              </CardHeader>
              <CardBody>
                {loading ? (
                  <div className="text-center py-8 text-muted-token text-sm">Loading...</div>
                ) : recentEntries.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted-token">
                    <TrendingUp className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">Your {t('tracker', 'Sadhana').toLowerCase()} journey starts today.</p>
                    <Link to="/trackers" className="mt-3 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      Add Today's Entry →
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border-color)]">
                    {recentEntries.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-token">{formatDate(r.period_date)}</p>
                          {r.tracker_definitions?.name && (
                            <p className="text-xs text-muted-token mt-0.5">{r.tracker_definitions.name}</p>
                          )}
                        </div>
                        {r.score != null && (
                          <div className={`px-3 py-1.5 rounded-xl text-sm font-bold ${scoreBg(r.score)}`}>
                            {r.score.toFixed(1)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </motion.div>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Announcements */}
          {announcements.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Megaphone className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                      <h3 className="font-semibold text-primary-token">Announcements</h3>
                    </div>
                    <Link to="/announcements" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      View all →
                    </Link>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="divide-y divide-[var(--border-color)]">
                    {announcements.map((a) => (
                      <div key={a.id} className="py-2.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-primary-token">{a.title}</p>
                          {a.is_pinned && <Badge variant="saffron">Pinned</Badge>}
                        </div>
                        {a.body && <p className="text-sm text-secondary-token mt-0.5 line-clamp-2">{a.body}</p>}
                        <p className="text-xs text-muted-token mt-1">{formatDate(a.created_at)}</p>
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
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-primary-token">Upcoming Events</h3>
                    <Link to="/events" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      View all →
                    </Link>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="divide-y divide-[var(--border-color)]">
                    {events.map((e) => (
                      <div key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="flex items-start gap-2 min-w-0">
                          <CalendarDays className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary-token truncate">{e.title}</p>
                            {e.venue && (
                              <span className="flex items-center gap-1 text-xs text-muted-token mt-0.5">
                                <MapPin className="w-3 h-3" />
                                {e.venue}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="text-xs text-secondary-token">{format(new Date(e.start_datetime), 'dd MMM, h:mm a')}</span>
                          {e.is_mandatory && <Badge variant="red">Mandatory</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {/* Your Mentor */}
          {mentor && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <h3 className="font-semibold text-primary-token">Your {t('mentor', 'Mentor')}</h3>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="flex items-center gap-3">
                    <Avatar name={mentor.mentor_name} url={mentor.mentor_avatar} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-primary-token truncate">{mentor.mentor_name}</p>
                      {mentor.type_name && <Badge variant="default">{mentor.type_name}</Badge>}
                    </div>
                    {mentor.mentor_phone && (
                      <a
                        href={`https://wa.me/${mentor.mentor_phone.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-tulasi-600 hover:bg-tulasi-700 text-white text-sm font-medium transition-colors flex-shrink-0"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Message
                      </a>
                    )}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
