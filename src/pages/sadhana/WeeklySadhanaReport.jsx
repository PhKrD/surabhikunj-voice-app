import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Save, MessageCircle, ChevronLeft, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import { scoreWeek, WEEKLY_MAX, generateWeeklyWhatsAppMessage } from '@/lib/sadhanaScoring'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' }

// The columns we display in the grid, in the order shown in the spreadsheet.
const COLUMNS = [
  { key: 'to_bed_time',     label: 'TB',          type: 'time',   scoreKey: 'tb',          max: WEEKLY_MAX.tb },
  { key: 'wake_up_time',    label: 'WU',          type: 'time',   scoreKey: 'wu',          max: WEEKLY_MAX.wu },
  { key: 'day_rest_min',    label: 'DR (min)',    type: 'number', scoreKey: 'dr',          max: WEEKLY_MAX.dr },
  { key: 'japa_time',       label: 'JP (time)',   type: 'time',   scoreKey: 'japa',        max: WEEKLY_MAX.japa },
  { key: 'reading_min',     label: 'RD (min)',    type: 'number', scoreKey: 'reading',     max: WEEKLY_MAX.reading },
  { key: 'hearing_min',     label: 'HR (min)',    type: 'number', scoreKey: 'hearing',     max: WEEKLY_MAX.hearing },
  { key: 'morning_class',   label: 'MC',          type: 'bool',   scoreKey: 'mc',          max: WEEKLY_MAX.mc },
  { key: 'mangal_arti',     label: 'MA',          type: 'bool',   scoreKey: 'ma',          max: WEEKLY_MAX.ma },
  { key: 'studies_min',     label: 'Studies (min)',type: 'number', scoreKey: 'studies',     max: WEEKLY_MAX.studies },
  { key: 'cleanliness_done',label: 'Clean.',      type: 'bool',   scoreKey: 'cleanliness', max: WEEKLY_MAX.cleanliness },
]

// Empty day skeleton — matches sadhana_reports column names.
function emptyDay() {
  return {
    to_bed_time: '',
    wake_up_time: '',
    day_rest_min: 0,
    japa_time: '',
    japa_rounds: 0,
    reading_min: 0,
    hearing_min: 0,
    mangal_arti: false,
    morning_class: false,
    studies_min: 0,
    cleanliness_done: false,
  }
}

function emptyWeek() {
  return DAY_KEYS.reduce((acc, k) => ({ ...acc, [k]: emptyDay() }), {})
}

// Return the Monday of the ISO week containing `date`.
function weekStartFor(date) {
  return startOfWeek(date, { weekStartsOn: 1 })
}
function toISODate(d) {
  return format(d, 'yyyy-MM-dd')
}

// Map a Date -> weekday key ('sun' … 'sat')
function dayKeyOf(date) {
  return DAY_KEYS[date.getDay()]
}

export default function WeeklySadhanaReport() {
  const { profile } = useAuthStore()
  const [anchor, setAnchor] = useState(() => weekStartFor(new Date()))
  const [daily, setDaily] = useState(emptyWeek())
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const weekStartISO = toISODate(anchor)

  // Fetch existing weekly report + daily reports for the week and merge.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    try {
      const start = anchor
      const end = addDays(start, 6)
      const startISO = toISODate(start)
      const endISO = toISODate(end)

      const [weeklyRes, dailyRes] = await Promise.all([
        supabase
          .from('sadhana_weekly_reports')
          .select('*')
          .eq('profile_id', profile.id)
          .eq('week_start', startISO)
          .maybeSingle(),
        supabase
          .from('sadhana_reports')
          .select('*')
          .eq('profile_id', profile.id)
          .gte('report_date', startISO)
          .lte('report_date', endISO),
      ])

      const week = emptyWeek()

      // Merge daily reports first so weekly overrides them if present.
      for (const rep of (dailyRes.data ?? [])) {
        const d = new Date(rep.report_date)
        const key = dayKeyOf(d)
        week[key] = {
          to_bed_time: rep.to_bed_time || '',
          wake_up_time: rep.wake_up_time || '',
          day_rest_min: rep.day_rest_min || 0,
          japa_time: rep.japa_time || '',
          japa_rounds: rep.japa_rounds || 0,
          reading_min: rep.reading_min || 0,
          hearing_min: rep.hearing_min || 0,
          mangal_arti: !!rep.mangal_arti,
          morning_class: !!rep.morning_class,
          studies_min: rep.studies_min || 0,
          cleanliness_done: !!rep.cleanliness_done,
        }
      }

      // Overlay any existing weekly report data
      if (weeklyRes.data?.daily_data) {
        for (const k of DAY_KEYS) {
          if (weeklyRes.data.daily_data[k]) {
            week[k] = { ...week[k], ...weeklyRes.data.daily_data[k] }
          }
        }
      }

      setDaily(week)
      setNotes(weeklyRes.data?.notes || '')
      setDirty(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [profile?.id, anchor])

  useEffect(() => {
    const t = setTimeout(() => load(), 0)
    return () => clearTimeout(t)
  }, [load])

  // Compute all scores live
  const scores = useMemo(() => scoreWeek(daily), [daily])

  const setField = (dayKey, field, value) => {
    setDaily((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], [field]: value },
    }))
    setDirty(true)
  }

  const goPrev = () => setAnchor((a) => subWeeks(a, 1))
  const goNext = () => setAnchor((a) => addWeeks(a, 1))
  const goToday = () => setAnchor(weekStartFor(new Date()))

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        voice_id: profile.voice_id,
        profile_id: profile.id,
        week_start: weekStartISO,
        daily_data: daily,
        total_tb: scores.totals.tb,
        total_wu: scores.totals.wu,
        total_dr: scores.totals.dr,
        total_japa: scores.totals.japa,
        total_reading: scores.totals.reading,
        total_hearing: scores.totals.hearing,
        total_mc: scores.totals.mc,
        total_ma: scores.totals.ma,
        total_studies: scores.totals.studies,
        total_cleanliness: scores.totals.cleanliness,
        total_score: scores.grandTotal,
        percent: scores.percent,
        notes,
        submitted_at: new Date().toISOString(),
      }
      const { error: err } = await supabase
        .from('sadhana_weekly_reports')
        .upsert(payload, { onConflict: 'profile_id,week_start' })
      if (err) throw err
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleWhatsApp = () => {
    const msg = generateWeeklyWhatsAppMessage({
      weekStart: weekStartISO,
      daily,
      totals: scores.totals,
      grandTotal: scores.grandTotal,
      percent: scores.percent,
      devoteeFullName: profile?.spiritual_name,
      notes,
    })
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const weekEnd = addDays(anchor, 6)
  const rangeLabel = `${format(anchor, 'dd MMM')} – ${format(weekEnd, 'dd MMM yyyy')}`

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <Card>
        <CardBody className="py-3 flex flex-wrap items-center gap-3">
          <Button onClick={goPrev} variant="ghost" size="sm" icon={ChevronLeft}>Prev</Button>
          <div className="flex-1 text-center">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Week Of</p>
            <p className="font-semibold text-slate-800">{rangeLabel}</p>
          </div>
          <Button onClick={goToday} variant="ghost" size="sm" icon={RefreshCw}>This Week</Button>
          <Button onClick={goNext} variant="ghost" size="sm" icon={ChevronRight}>Next</Button>
        </CardBody>
      </Card>

      {/* Grand total banner */}
      <motion.div
        key={scores.grandTotal}
        initial={{ scale: 0.98 }}
        animate={{ scale: 1 }}
        className="bg-gradient-to-r from-saffron-500 to-saffron-600 rounded-2xl p-4 text-white"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm opacity-80">Weekly Total</p>
            <p className="text-xs opacity-70">Auto-filled from your daily reports • Editable</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">
              {scores.grandTotal}
              <span className="text-lg opacity-70">/{WEEKLY_MAX.total}</span>
            </div>
            <div className="text-sm opacity-90">{scores.percent}%</div>
          </div>
        </div>
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {COLUMNS.map((c) => (
            <div key={c.key} className="text-center">
              <div className="text-sm font-bold">{scores.totals[c.scoreKey]}</div>
              <div className="text-[10px] opacity-70">{c.label}/{c.max}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Grid */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-slate-700">Daily Entries</h3>
        </CardHeader>
        <CardBody className="pt-0">
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-sm">Loading week…</div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Day</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase">
                        {c.label}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Day Total</th>
                  </tr>
                </thead>
                <tbody>
                  {DAY_KEYS.map((k) => {
                    // date of this weekday within the current week
                    const date = getDateForKey(anchor, k)
                    const isToday = isSameDay(date, new Date())
                    return (
                      <tr key={k} className={cn('border-b border-slate-50 last:border-0', isToday && 'bg-saffron-50/50')}>
                        <td className="py-2 px-2">
                          <div className="font-semibold text-slate-700">{DAY_LABELS[k]}</div>
                          <div className="text-[10px] text-slate-400">{format(date, 'dd MMM')}</div>
                        </td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="py-2 px-2">
                            <CellInput
                              type={c.type}
                              value={daily[k]?.[c.key]}
                              onChange={(v) => setField(k, c.key, v)}
                            />
                          </td>
                        ))}
                        <td className="py-2 px-2 text-right">
                          <span className="inline-block px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                            {scores.days[k].total}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
              Notes for Sadhana In-charge (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true) }}
              rows={2}
              placeholder="Anything to share with your sadhana in-charge…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition resize-none"
            />
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} loading={saving} icon={Save} variant="primary" disabled={!dirty && !saved}>
          {saved ? 'Saved!' : dirty ? 'Save Week' : 'Saved'}
        </Button>
        <Button onClick={handleWhatsApp} variant="tulasi" icon={MessageCircle}>
          Send to Sadhana In-charge
        </Button>
      </div>

      <p className="text-xs text-slate-400">
        * Values are pre-filled from your daily reports for this week. Edit any cell to override and Save to persist.
      </p>
    </div>
  )
}

// Return the date for a weekday key within the given week (anchor = Monday).
function getDateForKey(monday, key) {
  const offsetFromMonday = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  return addDays(monday, offsetFromMonday[key])
}

function CellInput({ type, value, onChange }) {
  if (type === 'time') {
    return (
      <input
        type="time"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 px-2 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-saffron-300"
      />
    )
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={0}
        className="w-20 px-2 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-saffron-300"
      />
    )
  }
  // bool
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'w-8 h-6 rounded-md text-xs font-bold flex items-center justify-center transition',
        value ? 'bg-tulasi-500 text-white' : 'bg-slate-100 text-slate-400'
      )}
      aria-pressed={!!value}
    >
      {value ? '✓' : '—'}
    </button>
  )
}
