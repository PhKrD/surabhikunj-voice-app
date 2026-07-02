import { lazy, Suspense, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, PlusCircle, TrendingUp, Calendar, Award, Flame, CalendarRange, Settings } from 'lucide-react'
import { format } from 'date-fns'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { scoreBg, formatDate, minutesToHHMM, formatTime, isAdmin } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useCachedQuery, invalidateCache } from '@/lib/useCachedQuery'
import useAuthStore from '@/store/authStore'
import { computeSadhanaStats } from '@/lib/sadhanaStats'
import SadhanaReportForm from './SadhanaReportForm'

const SadhanaTrendChart = lazy(() => import('./SadhanaTrendChart'))
const WeeklySadhanaReport = lazy(() => import('./WeeklySadhanaReport'))
const SadhanaConfigEditor = lazy(() => import('./SadhanaConfigEditor'))

export default function SadhanaPage() {
  const { profile } = useAuthStore()
  const [view, setView] = useState('history') // 'history' | 'form' | 'analytics'

  const { data: reports = [], loading: queryLoading, refetch } = useCachedQuery(
    profile ? `sadhana:reports:${profile.id}` : null,
    async () => {
      const { data } = await supabase
        .from('sadhana_reports')
        .select('*')
        .eq('profile_id', profile.id)
        .order('report_date', { ascending: false })
        .limit(90)
      return data ?? []
    }
  )

  const loading = !profile || queryLoading

  const handleSaved = () => {
    refetch()
    invalidateCache('dashboard:', { prefix: true })
    setView('history')
  }

  const chartData = [...reports].reverse().slice(-14).map((r) => ({
    date: format(new Date(r.report_date), 'dd MMM'),
    score: r.score ?? 0,
    japa: r.score_japa ?? 0,
    reading: r.score_reading ?? 0,
  }))

  const avgScore = reports.length
    ? Math.round(reports.reduce((s, r) => s + (r.score ?? 0), 0) / reports.length)
    : 0

  const stats = useMemo(() => computeSadhanaStats(reports), [reports])

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'history', label: 'History', icon: Calendar },
          { key: 'form', label: 'New Report', icon: PlusCircle },
          { key: 'weekly', label: 'Weekly Report', icon: CalendarRange },
          { key: 'analytics', label: 'Analytics', icon: TrendingUp },
          ...(isAdmin(profile?.role) || profile?.role === 'coordinator' ? 
            [{ key: 'config', label: 'Configuration', icon: Settings }] : []),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
              view === tab.key
                ? 'bg-saffron-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* New Report Form */}
      {view === 'form' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <SadhanaReportForm onSaved={handleSaved} />
        </motion.div>
      )}

      {/* Weekly Report */}
      {view === 'weekly' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Suspense fallback={<div className="text-center py-12 text-slate-400 text-sm">Loading weekly report…</div>}>
            <WeeklySadhanaReport />
          </Suspense>
        </motion.div>
      )}

      {/* History */}
      {view === 'history' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {loading && (
            <div className="text-center py-12 text-slate-400 text-sm">Loading reports...</div>
          )}
          {!loading && reports.length === 0 && (
            <Card>
              <CardBody>
                <div className="flex flex-col items-center py-10 text-slate-400">
                  <BookOpen className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">No reports yet.</p>
                  <Button onClick={() => setView('form')} variant="primary" className="mt-4" size="sm">
                    Submit First Report
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
          {reports.slice(0, 30).map((r) => (
            <Card key={r.id}>
              <CardBody className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800">{formatDate(r.report_date)}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                      <span>WU: {formatTime(r.wake_up_time)}</span>
                      <span>JP: {r.japa_rounds ?? 0} rounds @ {formatTime(r.japa_time)}</span>
                      <span>RD: {minutesToHHMM(r.reading_min)}</span>
                      <span>HR: {minutesToHHMM(r.hearing_min)}</span>
                      <span>Seva: {r.seva_hours ?? 0} hrs</span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {r.mangal_arti && <Badge variant="tulasi">MA ✓</Badge>}
                      {r.morning_class && <Badge variant="blue">MC ✓</Badge>}
                      {r.day_rest_min > 0 && <Badge variant="yellow">DR: {minutesToHHMM(r.day_rest_min)}</Badge>}
                    </div>
                  </div>
                  <div className={`px-3 py-1.5 rounded-xl text-sm font-bold ${scoreBg(r.score ?? 0)}`}>
                    {(r.score ?? 0).toFixed(1)}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Configuration */}
      {view === 'config' && (isAdmin(profile?.role) || profile?.role === 'coordinator') && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Suspense fallback={<div className="text-center py-12 text-slate-400 text-sm">Loading configuration…</div>}>
            <SadhanaConfigEditor />
          </Suspense>
        </motion.div>
      )}

      {/* Analytics */}
      {view === 'analytics' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Streak banner */}
          <div className="bg-gradient-to-r from-saffron-500 to-saffron-600 rounded-2xl p-4 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                <Flame className="w-6 h-6" />
              </div>
              <div>
                <p className="text-3xl font-bold leading-none">
                  {stats.currentStreak}
                  <span className="text-base font-medium opacity-80"> day{stats.currentStreak === 1 ? '' : 's'}</span>
                </p>
                <p className="text-sm opacity-80 mt-0.5">Current streak</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold leading-none">{stats.longestStreak}</p>
              <p className="text-xs opacity-80 mt-0.5">Longest streak</p>
            </div>
          </div>

          {/* Rollups */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardBody className="text-center py-5">
                <Calendar className="w-7 h-7 text-saffron-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800">{stats.weekAvg}</p>
                <p className="text-xs text-slate-500">This Week ({stats.weekCount})</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center py-5">
                <Calendar className="w-7 h-7 text-tulasi-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800">{stats.monthAvg}</p>
                <p className="text-xs text-slate-500">This Month ({stats.monthCount})</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center py-5">
                <Award className="w-7 h-7 text-lotus-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800">{avgScore}</p>
                <p className="text-xs text-slate-500">All-time Avg</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center py-5">
                <TrendingUp className="w-7 h-7 text-blue-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800">{reports.filter((r) => r.mangal_arti).length}</p>
                <p className="text-xs text-slate-500">MA Days</p>
              </CardBody>
            </Card>
          </div>

          {chartData.length > 1 && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold text-slate-700">Score Trend (Last 14 Days)</h3>
              </CardHeader>
              <CardBody>
                <Suspense fallback={<div className="h-[200px] flex items-center justify-center text-sm text-slate-400">Loading chart…</div>}>
                  <SadhanaTrendChart data={chartData} />
                </Suspense>
              </CardBody>
            </Card>
          )}
        </motion.div>
      )}
    </div>
  )
}
