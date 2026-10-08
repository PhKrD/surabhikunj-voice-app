import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  BookOpen, CalendarDays, CheckCircle2, ChevronRight, Circle, Clock, MapPin, Megaphone,
  MessageCircle, Sparkles, TrendingUp, UserPlus, UtensilsCrossed, ListChecks,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/useCachedQuery'
import { localDateISO } from '@/lib/dates'
import { cn, formatDate, formatTime, scoreBg } from '@/lib/utils'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardHeader, CardBody, CardTitle } from '@/components/ui/Card'
import Badge, { StatusBadge } from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { buttonClass } from '@/components/ui/buttonStyles'
import DynamicIcon from '@/components/ui/DynamicIcon'
import ProgressRing from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'

const FALLBACK_QUOTE = {
  label: 'Verse of the day',
  text: 'One who has taken birth in this human form of life, if he does not utilize this opportunity for self-realization, is certainly the killer of his own self.',
  source: 'Śrīmad-Bhāgavatam 11.20.17',
}

function greetingFor(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function ViewAll({ to, label = 'View all' }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 h-9 -mr-2 px-2 rounded-[var(--radius-sm)] text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]"
    >
      {label}
      <ChevronRight className="w-4 h-4" aria-hidden="true" />
    </Link>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-36 w-full rounded-[var(--radius-lg)]" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-lg)]" />)}
      </div>
      <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />
    </div>
  )
}

export default function Dashboard() {
  const { profile, profileLoading, profileError, user, fetchProfile } = useAuthStore()
  const { org, nav, t, settings, hasPermission } = useOrgStore()
  const orgId = org?.id ?? profile?.org_id
  const quote = settings?.branding?.dailyQuote ?? FALLBACK_QUOTE
  const canApprove = hasPermission('members.approve') || hasPermission('members.manage')
  const trackerLabel = t('tracker', 'Sadhana')

  const quickNav = nav
    .filter((n) => n.route && !['settings', 'notifications', 'dashboard'].includes(n.key))
    .slice(0, 8)

  const displayName = profile?.display_name ?? ''
  const firstName = displayName.split(' ')[0] || t('member', 'Member')
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayISO = localDateISO(now)

  const { data, loading, error, refetch } = useCachedQuery(
    profile && orgId ? `dashboard:${profile.id}:${orgId}:${todayISO}:${canApprove}` : null,
    async () => {
      const nowISO = new Date().toISOString()
      const [
        trackerEntriesRes, taskAssignRes, taskLogRes, resourcePlansRes,
        eventsRes, recentTrackerRes, announcementsRes, mentorRes, pendingRes,
      ] = await Promise.all([
        supabase.from('tracker_entries')
          .select('id, score, tracker_definitions(id, name, color)')
          .eq('user_id', profile.id).eq('org_id', orgId).eq('period_date', todayISO),
        supabase.from('task_assignments')
          .select('id, task_time, task_templates(name)')
          .eq('user_id', profile.id).eq('task_date', todayISO).order('task_time'),
        supabase.from('task_logs')
          .select('assignment_id, status')
          .eq('user_id', profile.id).eq('log_date', todayISO),
        supabase.from('resource_plans')
          .select('id, resource_types(name, icon, color), resource_plan_items(name, quantity, sort_order)')
          .eq('org_id', orgId).eq('plan_date', todayISO),
        supabase.from('events')
          .select('id, title, start_datetime, venue, event_type, is_mandatory')
          .eq('org_id', orgId).eq('is_active', true).gte('start_datetime', nowISO)
          .order('start_datetime', { ascending: true }).limit(4),
        supabase.from('tracker_entries')
          .select('id, period_date, score, tracker_definitions(name, color)')
          .eq('user_id', profile.id).eq('org_id', orgId)
          .order('period_date', { ascending: false }).limit(5),
        supabase.from('announcements')
          .select('id, title, body, is_pinned, created_at')
          .eq('org_id', orgId)
          .order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(3),
        supabase.rpc('my_mentor'),
        canApprove
          ? supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending')
          : Promise.resolve({ count: 0 }),
      ])

      // The essentials failing means the screen is wrong, not just empty.
      if (trackerEntriesRes.error && announcementsRes.error && eventsRes.error) throw trackerEntriesRes.error

      const taskLogMap = {}
      for (const l of taskLogRes.data ?? []) taskLogMap[l.assignment_id] = l.status
      const tasks = (taskAssignRes.data ?? []).map((a) => ({ ...a, status: taskLogMap[a.id] ?? 'pending' }))

      const scored = (trackerEntriesRes.data ?? []).filter((e) => e.score != null)
      const avgScore = scored.length ? Math.round(scored.reduce((s, e) => s + e.score, 0) / scored.length) : null

      return {
        trackerScore: avgScore,
        trackerCount: (trackerEntriesRes.data ?? []).length,
        tasks,
        resourcePlans: resourcePlansRes.data ?? [],
        events: eventsRes.data ?? [],
        recentEntries: recentTrackerRes.data ?? [],
        announcements: announcementsRes.data ?? [],
        mentor: (mentorRes.data ?? [])[0] ?? null,
        pendingApprovals: pendingRes.count ?? 0,
      }
    },
  )

  if (profileError && !profile) {
    return (
      <Card className="max-w-md mx-auto mt-10">
        <ErrorState
          title="Couldn’t load your profile"
          error={profileError}
          onRetry={() => user?.id && fetchProfile(user.id)}
        />
        {profileLoading && <p className="sr-only">Retrying</p>}
      </Card>
    )
  }

  if (!profile || (loading && !data)) return <DashboardSkeleton />

  const {
    trackerScore = null, trackerCount = 0, tasks = [], resourcePlans = [], events = [],
    recentEntries = [], announcements = [], mentor = null, pendingApprovals = 0,
  } = data ?? {}
  const tasksDone = tasks.filter((x) => x.status === 'done' || x.status === 'verified').length
  const filledToday = trackerCount > 0

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption">{todayLabel}</p>
          <h2 className="text-display text-primary-token mt-0.5 truncate">
            {greetingFor(now.getHours())}, {firstName}
          </h2>
        </div>
        {profile.role && <Badge variant="primary" className="mt-1 capitalize">{String(profile.role).replace(/_/g, ' ')}</Badge>}
      </div>

      {error && !data && <Card><ErrorState error={error} onRetry={refetch} compact /></Card>}

      {/* Admin: something needs a decision */}
      {pendingApprovals > 0 && (
        <Link to="/members" className="block">
          <Card hover className="flex items-center gap-4 p-4 border-[var(--color-warning-soft)]">
            <span className="w-11 h-11 rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-heading text-primary-token">
                {pendingApprovals} {pendingApprovals === 1 ? 'person is' : 'people are'} waiting to join
              </p>
              <p className="text-caption">Review and approve new members</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-token flex-shrink-0" aria-hidden="true" />
          </Card>
        </Link>
      )}

      {/* Today */}
      <Card className="p-5">
        <div className="flex items-center gap-5">
          <div className="flex-shrink-0">
            {trackerScore != null ? (
              <ProgressRing value={trackerScore} size={76} strokeWidth={7} color="var(--color-primary)" />
            ) : (
              <span
                className={cn(
                  'w-[76px] h-[76px] rounded-full flex items-center justify-center',
                  filledToday ? 'bg-[var(--color-success-soft)]' : 'bg-[var(--color-primary-soft)]',
                )}
              >
                {filledToday
                  ? <CheckCircle2 className="w-9 h-9 text-[var(--color-success)]" aria-hidden="true" />
                  : <BookOpen className="w-8 h-8 text-[var(--color-primary)]" aria-hidden="true" />}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-overline">Today’s {trackerLabel}</p>
            <p className="text-title text-primary-token mt-1">
              {filledToday ? (trackerScore != null ? `${trackerScore}% complete` : 'Submitted') : 'Not filled yet'}
            </p>
            {tasks.length > 0 && (
              <p className="text-caption mt-1">
                {tasksDone} of {tasks.length} {t('tasks', 'tasks').toLowerCase()} done
              </p>
            )}
          </div>
        </div>
        <Link
          to="/trackers"
          className={buttonClass({ variant: filledToday ? 'secondary' : 'primary', className: 'w-full mt-5' })}
        >
          {filledToday ? `Review today’s ${trackerLabel}` : `Fill today’s ${trackerLabel}`}
        </Link>
      </Card>

      {/* Quick actions — driven by my_navigation() */}
      {quickNav.length > 0 && (
        <section aria-label="Quick actions">
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {quickNav.map((mod) => {
              return (
                <Link
                  key={mod.route}
                  to={mod.route}
                  className="press flex flex-col items-center gap-2 py-3 px-1 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border-color)] hover:shadow-[var(--shadow-2)] transition-shadow"
                >
                  <span className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] flex items-center justify-center">
                    <DynamicIcon name={mod.icon} fallback={BookOpen} className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
                  </span>
                  <span className="text-[0.75rem] font-medium text-secondary-token text-center leading-tight line-clamp-2 w-full">
                    {mod.label || mod.key}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {/* Today's tasks */}
          {tasks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle icon={ListChecks} action={<ViewAll to="/services" />}>
                  Today’s {t('tasks', 'Tasks')}
                </CardTitle>
              </CardHeader>
              <ul className="px-4 sm:px-5 pb-2 divide-y divide-[var(--border-color)]">
                {tasks.map((task) => {
                  const done = task.status === 'done' || task.status === 'verified'
                  return (
                    <li key={task.id} className="flex items-center gap-3 py-3">
                      {done
                        ? <CheckCircle2 className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" aria-hidden="true" />
                        : <Circle className="w-5 h-5 text-[var(--border-strong)] flex-shrink-0" aria-hidden="true" />}
                      <span className={cn('flex-1 min-w-0 text-body truncate', done ? 'text-muted-token line-through' : 'text-primary-token')}>
                        {task.task_templates?.name ?? 'Task'}
                      </span>
                      {task.task_time && (
                        <span className="hidden sm:flex items-center gap-1 text-caption">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          {formatTime(task.task_time)}
                        </span>
                      )}
                      <StatusBadge status={task.status} />
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {/* Announcements */}
          <Card>
            <CardHeader>
              <CardTitle icon={Megaphone} action={announcements.length > 0 && <ViewAll to="/announcements" />}>
                Announcements
              </CardTitle>
            </CardHeader>
            {announcements.length === 0 ? (
              <EmptyState compact icon={Megaphone} title="No announcements" description="Updates from your organization will appear here." />
            ) : (
              <ul className="px-4 sm:px-5 pb-2 divide-y divide-[var(--border-color)]">
                {announcements.map((a) => (
                  <li key={a.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-body font-semibold text-primary-token min-w-0 truncate">{a.title}</p>
                      {a.is_pinned && <Badge variant="accent">Pinned</Badge>}
                    </div>
                    {a.body && <p className="text-caption mt-1 line-clamp-2">{a.body}</p>}
                    <p className="text-[0.75rem] text-muted-token mt-1.5">{formatDate(a.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle icon={TrendingUp} action={recentEntries.length > 0 && <ViewAll to="/trackers" />}>
                Recent activity
              </CardTitle>
            </CardHeader>
            {recentEntries.length === 0 ? (
              <EmptyState
                compact
                icon={Sparkles}
                title={`Your ${trackerLabel.toLowerCase()} journey starts today`}
                description="Your recent entries and scores will show here."
              />
            ) : (
              <ul className="px-4 sm:px-5 pb-2 divide-y divide-[var(--border-color)]">
                {recentEntries.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-body font-medium text-primary-token">{formatDate(r.period_date)}</p>
                      {r.tracker_definitions?.name && <p className="text-caption">{r.tracker_definitions.name}</p>}
                    </div>
                    {r.score != null && (
                      <span className={cn('px-3 h-8 inline-flex items-center rounded-full text-sm font-bold tabular', scoreBg(r.score))}>
                        {Number(r.score).toFixed(1)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {/* Verse */}
          {quote?.text && (
            <Card variant="muted" className="p-5">
              <p className="text-overline !text-[var(--color-accent)]">{quote.label ?? 'Verse of the day'}</p>
              <blockquote className="mt-2 text-body text-primary-token leading-relaxed italic">“{quote.text}”</blockquote>
              {quote.source && <p className="text-caption mt-3 font-semibold">— {quote.source}</p>}
            </Card>
          )}

          {/* Upcoming events */}
          <Card>
            <CardHeader>
              <CardTitle icon={CalendarDays} action={events.length > 0 && <ViewAll to="/events" />}>
                Upcoming events
              </CardTitle>
            </CardHeader>
            {events.length === 0 ? (
              <EmptyState compact icon={CalendarDays} title="Nothing scheduled" />
            ) : (
              <ul className="px-4 sm:px-5 pb-2 divide-y divide-[var(--border-color)]">
                {events.map((e) => {
                  const start = new Date(e.start_datetime)
                  return (
                    <li key={e.id} className="flex items-center gap-3 py-3">
                      <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-[0.625rem] font-bold uppercase text-[var(--color-primary)] leading-none">{format(start, 'MMM')}</span>
                        <span className="text-lg font-bold text-primary-token leading-tight tabular">{format(start, 'd')}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-body font-semibold text-primary-token truncate">{e.title}</p>
                        <p className="text-caption flex items-center gap-1 truncate">
                          {format(start, 'h:mm a')}
                          {e.venue && (<><span aria-hidden="true">·</span><MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" /><span className="truncate">{e.venue}</span></>)}
                        </p>
                      </div>
                      {e.is_mandatory && <Badge variant="danger">Required</Badge>}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Today's resources */}
          {resourcePlans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle icon={UtensilsCrossed} action={<ViewAll to="/resources" />}>Today’s resources</CardTitle>
              </CardHeader>
              <ul className="px-4 sm:px-5 pb-2 divide-y divide-[var(--border-color)]">
                {resourcePlans.map((plan) => (
                  <li key={plan.id} className="py-3">
                    <p className="text-body font-semibold text-primary-token">{plan.resource_types?.name ?? 'Resource'}</p>
                    {(plan.resource_plan_items ?? []).length > 0 && (
                      <p className="text-caption mt-0.5">
                        {[...plan.resource_plan_items].sort((a, b) => a.sort_order - b.sort_order).map((i) => i.name).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Mentor */}
          {mentor && (
            <Card>
              <CardHeader>
                <h3 className="text-heading text-primary-token">Your {t('mentor', 'mentor')}</h3>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex items-center gap-3">
                  <Avatar name={mentor.mentor_name} url={mentor.mentor_avatar} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-body font-semibold text-primary-token truncate">{mentor.mentor_name}</p>
                    {mentor.type_name && <p className="text-caption truncate">{mentor.type_name}</p>}
                  </div>
                  {mentor.mentor_phone && (
                    <a
                      href={`https://wa.me/${mentor.mentor_phone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[var(--radius-md)] bg-[var(--color-success)] text-white text-sm font-semibold flex-shrink-0"
                    >
                      <MessageCircle className="w-4 h-4" aria-hidden="true" />
                      Message
                    </a>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
