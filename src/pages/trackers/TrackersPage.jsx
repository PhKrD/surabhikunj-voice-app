import { useState, useEffect, useMemo, useRef } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Plus, Settings, ChevronLeft, Clock, Calendar, TrendingUp, Share2, Flame, Sparkles, ChevronRight, Zap, Table2, Award, Loader2 } from 'lucide-react'
import { format, parseISO, addDays, subDays, isToday } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Can from '@/components/Can'
import { useTerm } from '@/hooks/usePermission'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import TrackerTrendChart from './TrackerTrendChart'
import TrackerSpreadsheet from './TrackerSpreadsheet'
import WeeklySadhanaCard from './WeeklySadhanaCard'
import WhatsAppShareModal from './WhatsAppShareModal'
import TrackerBuilder from './TrackerBuilder'
import TrackerSettings from './TrackerSettings'
import { calculateEntryScore } from '@/lib/trackerScoring'
import { buildTemplateVariables, renderTemplate, FALLBACK_TEMPLATE, formatFieldValue } from '@/lib/trackerWhatsapp'
import { fetchTrackerConfig } from '@/lib/trackerApi'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TIME_PRESETS_AM = ['04:00','04:30','05:00','05:30','06:00','06:30','07:00','07:30','08:00','09:00','10:00']
const TIME_PRESETS_PM = ['12:00','13:00','18:00','19:00','20:00','21:00','21:30','22:00','22:30']

function toDisplay(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 || 12
  return { h: hh, m: String(m).padStart(2, '0'), ampm }
}

function toDisplayStr(t) {
  if (!t) return ''
  const d = toDisplay(t)
  return `${d.h}:${d.m} ${d.ampm}`
}

function addMinutes(t, delta) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const total = h * 60 + m + delta
  const next = (total % 1440 + 1440) % 1440
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// TimeInput — beautiful time picker
// ---------------------------------------------------------------------------
function TimeInput({ value, onChange }) {
  const [showCustom, setShowCustom] = useState(false)
  const nativeRef = useRef(null)
  const d = value ? toDisplay(value) : null

  const Chip = ({ t }) => (
    <button
      type="button"
      onClick={() => { onChange(t); setShowCustom(false) }}
      className={cn(
        'px-3 py-1.5 rounded-2xl text-xs font-semibold border transition-all active:scale-95',
        value === t
          ? 'bg-gradient-to-r from-saffron-500 to-orange-400 text-white border-transparent shadow-sm shadow-orange-200'
          : 'bg-white/80 text-slate-600 border-slate-200 hover:border-saffron-300 hover:text-saffron-600 hover:bg-saffron-50'
      )}
    >
      {toDisplayStr(t)}
    </button>
  )

  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
      {/* Big time display */}
      <div className={cn(
        'flex items-center justify-between px-5 py-4',
        d ? 'bg-gradient-to-r from-saffron-500 to-orange-400' : 'bg-gradient-to-r from-slate-200 to-slate-100'
      )}>
        {d ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-extrabold text-white tracking-tight">{d.h}:{d.m}</span>
            <span className="text-lg font-semibold text-white/80">{d.ampm}</span>
          </div>
        ) : (
          <span className="text-base font-medium text-slate-400">Not set</span>
        )}
        <div className="flex items-center gap-2">
          {d && (
            <>
              <button
                type="button"
                onClick={() => onChange(addMinutes(value, -15))}
                className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center justify-center transition active:scale-95"
              >−15</button>
              <button
                type="button"
                onClick={() => onChange(addMinutes(value, 15))}
                className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center justify-center transition active:scale-95"
              >+15</button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setShowCustom(true); setTimeout(() => nativeRef.current?.showPicker?.(), 50) }}
            className={cn(
              'w-9 h-9 rounded-2xl flex items-center justify-center transition active:scale-95',
              d ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-saffron-500'
            )}
            title="Pick custom time"
          >
            <Clock className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hidden native input */}
      {showCustom && (
        <input
          ref={nativeRef}
          type="time"
          value={value ?? ''}
          onChange={(e) => { onChange(e.target.value); setShowCustom(false) }}
          className="sr-only"
          autoFocus
        />
      )}

      {/* Preset rows */}
      <div className="p-3 space-y-2.5">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 px-0.5">Morning</p>
          <div className="flex flex-wrap gap-1.5">
            {TIME_PRESETS_AM.map((t) => <Chip key={t} t={t} />)}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 px-0.5">Evening · Night</p>
          <div className="flex flex-wrap gap-1.5">
            {TIME_PRESETS_PM.map((t) => <Chip key={t} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DurationInput — minute-based stepper with presets
// ---------------------------------------------------------------------------
const DUR_PRESETS = [0, 10, 15, 20, 30, 45, 60, 90, 120]

function DurationInput({ value, onChange, unit = 'min' }) {
  const num = parseInt(value, 10) || 0

  const adjust = (delta) => {
    const next = Math.max(0, num + delta)
    onChange(String(next))
  }

  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
      {/* Display + stepper */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-blue-500 to-violet-500">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-extrabold text-white">{num}</span>
          <span className="text-sm font-semibold text-white/70">{unit}</span>
        </div>
        <div className="flex gap-2">
          {[-15, -5].map((d) => (
            <button key={d} type="button" onClick={() => adjust(d)}
              className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center justify-center transition active:scale-95">
              {d}
            </button>
          ))}
          {[5, 15].map((d) => (
            <button key={d} type="button" onClick={() => adjust(d)}
              className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center justify-center transition active:scale-95">
              +{d}
            </button>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-1.5 p-3">
        {DUR_PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => onChange(String(p))}
            className={cn(
              'px-3 py-1.5 rounded-2xl text-xs font-semibold border transition-all active:scale-95',
              num === p
                ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white border-transparent shadow-sm shadow-violet-200'
                : 'bg-white/80 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50'
            )}>
            {p === 0 ? 'None' : `${p}m`}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CountInput — integer stepper with presets (for Japa Rounds etc.)
// ---------------------------------------------------------------------------
function CountInput({ value, onChange, unit = '', presets = [4, 8, 12, 16, 20, 25, 32] }) {
  const num = parseInt(value, 10) || 0

  const adjust = (delta) => onChange(String(Math.max(0, num + delta)))

  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-tulasi-500 to-emerald-500">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-extrabold text-white">{num}</span>
          {unit && <span className="text-sm font-semibold text-white/70 ml-1">{unit}</span>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => adjust(-1)}
            className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-lg font-bold flex items-center justify-center transition active:scale-95">−</button>
          <button type="button" onClick={() => adjust(1)}
            className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-lg font-bold flex items-center justify-center transition active:scale-95">+</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 p-3">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => onChange(String(p))}
            className={cn(
              'px-3 py-1.5 rounded-2xl text-xs font-semibold border transition-all active:scale-95',
              num === p
                ? 'bg-gradient-to-r from-tulasi-500 to-emerald-500 text-white border-transparent shadow-sm shadow-emerald-200'
                : 'bg-white/80 text-slate-600 border-slate-200 hover:border-tulasi-300 hover:text-tulasi-600 hover:bg-tulasi-50'
            )}>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field input renderer
// ---------------------------------------------------------------------------
function FieldInput({ field, value, onChange }) {
  const base = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

  if (field.field_type === 'boolean') {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'inline-flex items-center gap-3 px-5 py-3 rounded-2xl text-sm font-semibold border transition-all active:scale-[0.97]',
          value
            ? 'bg-gradient-to-r from-tulasi-500 to-emerald-500 text-white border-transparent shadow-sm shadow-emerald-200'
            : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
        )}
      >
        <span className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
          value ? 'bg-white/30 border-white' : 'border-slate-300'
        )}>
          {value && <span className="w-2 h-2 rounded-full bg-white block" />}
        </span>
        {value ? 'Yes — Done' : 'No — Not done'}
      </button>
    )
  }

  if (field.field_type === 'select') {
    const opts = Array.isArray(field.options) ? field.options : []
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Select…</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  if (field.field_type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? field.label}
        className={`${base} resize-none`}
      />
    )
  }

  if (field.field_type === 'time') {
    return <TimeInput value={value} onChange={onChange} />
  }

  if (field.field_type === 'duration_min') {
    return <DurationInput value={value} onChange={onChange} unit={field.unit ?? 'min'} />
  }

  if (field.field_type === 'number') {
    const presets = field.key?.includes('round') ? [4, 8, 12, 16, 20, 24, 32]
      : field.key?.includes('japa') ? [4, 8, 12, 16, 20, 24, 32]
      : undefined
    return <CountInput value={value} onChange={onChange} unit={field.unit ?? ''} presets={presets} />
  }

  const inputType = 'text'

  return (
    <div className="relative">
      <input
        type={inputType}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? field.label}
        min={field.min_value ?? undefined}
        max={field.max_value ?? undefined}
        className={base}
      />
      {field.unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{field.unit}</span>
      )}
    </div>
  )
}

// Derive a richer gradient pair from a base hex color
function colorToGradient(hex) {
  const presets = {
    '#f97316': 'from-orange-400 via-saffron-500 to-orange-600',
    '#22c55e': 'from-emerald-400 via-tulasi-500 to-green-600',
    '#3b82f6': 'from-blue-400 via-blue-500 to-indigo-600',
    '#d946ef': 'from-fuchsia-400 via-lotus-500 to-purple-600',
    '#f43f5e': 'from-rose-400 via-red-500 to-rose-600',
    '#f59e0b': 'from-amber-400 via-yellow-500 to-orange-500',
    '#06b6d4': 'from-cyan-400 via-sky-500 to-blue-500',
    '#8b5cf6': 'from-violet-400 via-purple-500 to-indigo-600',
  }
  return presets[hex?.toLowerCase()] ?? 'from-orange-400 via-saffron-500 to-orange-600'
}

function TrackerCard({ t, onOpen, onSettings }) {
  const grad = colorToGradient(t.color)

  return (
    <div
      onClick={onOpen}
      className="group relative rounded-3xl overflow-hidden cursor-pointer press hover-lift elev-2"
    >
      {/* Gradient background */}
      <div className={cn('absolute inset-0 bg-gradient-to-br', grad)} />

      {/* Decorative orbs */}
      <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-black/10 blur-2xl" />

      {/* Faint inner grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />

      <div className="relative p-5">
        {/* Top row */}
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-white/25 backdrop-blur-sm ring-1 ring-white/40 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <div className="flex items-center gap-2">
            {t.has_scoring && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/20 text-white/90 text-[11px] font-semibold backdrop-blur-sm">
                <Zap className="w-3 h-3" /> Scored
              </span>
            )}
            <span className="px-2.5 py-1 rounded-xl bg-black/15 text-white/90 text-[11px] font-semibold capitalize backdrop-blur-sm">
              {t.cadence}
            </span>
            <Can permission="trackers.manage">
              <button
                onClick={(e) => { e.stopPropagation(); onSettings() }}
                className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
              >
                <Settings className="w-3.5 h-3.5 text-white" />
              </button>
            </Can>
          </div>
        </div>

        {/* Name + description */}
        <div className="mb-4">
          <h3 className="text-lg font-extrabold text-white leading-tight mb-1">{t.name}</h3>
          {t.description && (
            <p className="text-sm text-white/75 line-clamp-2 leading-relaxed">{t.description}</p>
          )}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white/60 uppercase tracking-widest">Fill today</span>
          <div className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/35 flex items-center justify-center transition group-hover:translate-x-0.5">
            <ChevronRight className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackerList() {
  const [trackers, setTrackers] = useState([])
  const [loading, setLoading]   = useState(true)
  const navigate = useNavigate()
  const label = useTerm('trackers', 'Sadhana')

  useEffect(() => {
    supabase
      .from('tracker_definitions')
      .select('id, name, description, icon, color, cadence, has_scoring, is_active')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { setTrackers(data ?? []); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
      <div className="w-12 h-12 rounded-2xl grad-saffron animate-pulse flex items-center justify-center">
        <Flame className="w-6 h-6 text-white" />
      </div>
      <p className="text-sm text-slate-400 font-medium">Loading your {label}…</p>
    </div>
  )

  return (
    <div className="space-y-0">
      {/* ── Hero banner ── */}
      <div className="relative overflow-hidden rounded-3xl mb-8 mx-1">
        <div className="absolute inset-0 bg-gradient-to-br from-saffron-500 via-orange-500 to-amber-400" />
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-black/10 blur-2xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />
        <div className="relative px-6 py-8 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-white/80" />
              <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Daily Practice</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white leading-tight mb-1">{label}</h1>
            <p className="text-sm text-white/70 max-w-xs">
              Track your spiritual practices and see your growth over time.
            </p>
          </div>
          <Can permission="trackers.manage">
            <Button
              size="sm"
              icon={Plus}
              onClick={() => navigate('new')}
              className="bg-white/20 hover:bg-white/30 text-white border-white/30 border backdrop-blur-sm shadow-none flex-shrink-0"
            >
              New
            </Button>
          </Can>
        </div>
      </div>

      {/* ── Empty state ── */}
      {trackers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-20 h-20 rounded-3xl grad-saffron flex items-center justify-center opacity-40">
            <BookOpen className="w-9 h-9 text-white" />
          </div>
          <div>
            <p className="font-bold text-slate-600 mb-1">No trackers yet</p>
            <p className="text-sm text-slate-400">Create your first tracker to begin.</p>
          </div>
          <Can permission="trackers.manage">
            <Button size="sm" icon={Plus} onClick={() => navigate('new')}>
              Create tracker
            </Button>
          </Can>
        </div>
      )}

      {/* ── Tracker grid ── */}
      {trackers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 stagger px-1">
          {trackers.map((t) => (
            <TrackerCard
              key={t.id}
              t={t}
              onOpen={() => navigate(t.id)}
              onSettings={() => navigate(`${t.id}/settings`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TrackerDetail() {
  const { trackerId } = useParams()
  const { profile } = useAuthStore()
  const { org } = useOrgStore()
  const navigate = useNavigate()
  const toast = useToastStore()
  const today = format(new Date(), 'yyyy-MM-dd')

  // ── Config / meta state (loaded once per trackerId) ─────────────────
  const [tracker, setTracker]     = useState(null)
  const [fields, setFields]       = useState([])
  const [groups, setGroups]       = useState([])
  const [rules, setRules]         = useState([])
  const [calculatedColumns, setCalculatedColumns] = useState([])
  const [template, setTemplate]   = useState(null)
  const [entries, setEntries]     = useState([])
  const [configLoading, setConfigLoading] = useState(true)

  // ── Per-date form state ──────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(today)
  const [fieldValues, setFieldValues] = useState({})
  const [notes, setNotes]         = useState('')
  const [existingEntry, setExistingEntry] = useState(null)
  const [dateLoading, setDateLoading] = useState(false)
  const [saving, setSaving]       = useState(false)

  // ── UI state ─────────────────────────────────────────────────────────
  const [view, setView]           = useState('today')
  const [showShare, setShowShare] = useState(false)

  // Keep a ref to fields so async callbacks always see the latest value
  const fieldsRef = useRef(fields)
  useEffect(() => { fieldsRef.current = fields }, [fields])

  // Race-condition guard: only the most-recently requested date's response wins
  const activeRequestRef = useRef(null)

  // ── 1. Config load — runs once per trackerId ─────────────────────────
  useEffect(() => {
    if (!trackerId) return
    let cancelled = false
    setConfigLoading(true)
    ;(async () => {
      try {
        const [cfg, entriesRes, templateRes] = await Promise.all([
          fetchTrackerConfig(trackerId),
          supabase.rpc('my_tracker_entries', { p_tracker_id: trackerId, p_limit: 30 }),
          supabase.from('tracker_whatsapp_templates').select('*').eq('tracker_id', trackerId).is('user_id', null).maybeSingle(),
        ])
        if (cancelled) return
        const fieldsData = (cfg.fields ?? []).sort((a, b) => a.sort_order - b.sort_order)
        setTracker(cfg.tracker)
        setFields(fieldsData)
        setGroups((cfg.groups ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
        setRules(cfg.rules ?? [])
        setCalculatedColumns((cfg.calculated_columns ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
        setTemplate(templateRes.data ?? null)
        setEntries(entriesRes.data ?? [])
      } catch (e) {
        if (!cancelled) toast.error('Could not load tracker', e.message)
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [trackerId, toast])

  // ── 2. Date-entry load — runs when selectedDate changes ──────────────
  // CRITICAL: always clears existingEntry FIRST to prevent stale-ID overwrites
  useEffect(() => {
    if (!trackerId || !profile?.id || configLoading) return
    const requestedDate = selectedDate
    const requestId = Symbol()          // unique token for this request
    activeRequestRef.current = requestId

    // Clear stale state immediately — prevents submitting to the wrong entry
    setExistingEntry(null)
    setNotes('')
    setFieldValues({})
    setDateLoading(true)

    ;(async () => {
      try {
        const { data: dateEntry, error } = await supabase
          .from('tracker_entries')
          .select('id, period_date, notes, score')
          .eq('tracker_id', trackerId)
          .eq('user_id', profile.id)
          .eq('period_date', requestedDate)
          .maybeSingle()
        if (error) throw error

        // Discard if a newer request has started
        if (activeRequestRef.current !== requestId) return

        if (dateEntry) {
          const { data: vals } = await supabase
            .from('tracker_field_values')
            .select('field_key, value_text')
            .eq('entry_id', dateEntry.id)

          if (activeRequestRef.current !== requestId) return

          const currentFields = fieldsRef.current
          const map = {}
          for (const v of vals ?? []) {
            const f = currentFields.find((ff) => ff.key === v.field_key)
            map[v.field_key] = f?.field_type === 'boolean'
              ? (v.value_text === 'true' || v.value_text === '1')
              : v.value_text
          }
          setExistingEntry(dateEntry)
          setNotes(dateEntry.notes ?? '')
          setFieldValues(map)
        } else {
          // No entry for this date — seed defaults, existingEntry stays null
          const defaults = {}
          for (const f of fieldsRef.current) {
            if (f.default_value != null)
              defaults[f.key] = f.field_type === 'boolean' ? f.default_value === 'true' : f.default_value
          }
          setFieldValues(defaults)
        }
      } catch (e) {
        if (activeRequestRef.current === requestId)
          toast.error('Could not load entry for this date', e.message)
      } finally {
        if (activeRequestRef.current === requestId) setDateLoading(false)
      }
    })()
  }, [trackerId, selectedDate, profile?.id, configLoading, toast])

  const scored = useMemo(() => (
    calculateEntryScore({ rules, fields, groups, calculatedColumns, fieldValues })
  ), [rules, fields, groups, calculatedColumns, fieldValues])

  const shareMessage = useMemo(() => {
    const devoteeName = profile?.display_name ?? profile?.spiritual_name ?? ''

    // If an admin has configured a custom WhatsApp template, render it.
    if (template?.body) {
      const vars = buildTemplateVariables({
        tracker, fields, groups, calculatedColumns, fieldValues,
        entryScore: scored, date: parseISO(selectedDate), devoteeName,
      })
      return renderTemplate(template.body, vars)
    }

    // Fallback: build a full human-readable report with every field.
    const lines = [
      'Hare Krishna Prabhuji,',
      '',
      `date : ${format(parseISO(selectedDate), 'd/M/yyyy')}`,
      '',
    ]
    for (const f of fields) {
      const label = f.label?.trim() || f.key
      const sep = label.endsWith(':') ? '' : ':'
      const raw = fieldValues[f.key]
      const value = f.field_type === 'boolean'
        ? (raw ? 'Y' : 'N')
        : formatFieldValue(f, raw)
      lines.push(`${label}${sep} ${value}`)
    }
    if (scored?.score != null) {
      lines.push('')
      lines.push(`Score: ${scored.score}%`)
    }
    lines.push('')
    lines.push(`ys ${devoteeName}`.trim())
    return lines.join('\n')
  }, [tracker, fields, groups, calculatedColumns, fieldValues, scored, template, profile, selectedDate])

  const handleShareWhatsApp = () => setShowShare(true)

  // ── 3. Submit handler ────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!profile || !org || saving) return   // guard against double-click

    // Snapshot everything we need synchronously — state must not shift during async
    const savingDate  = selectedDate
    const isUpdate    = !!existingEntry?.id
    const existingId  = existingEntry?.id
    const snapshotNotes = notes
    const snapshotValues = fieldValues
    const snapshotScore = scored?.score ?? null
    const snapshotScoreDetail = {
      fieldTotals: scored?.fieldTotals ?? {},
      groupTotals: scored?.groupTotals ?? {},
      columnTotals: scored?.columnTotals ?? {},
    }

    setSaving(true)
    try {
      const entryPayload = {
        tracker_id: trackerId,
        org_id: org.id,
        user_id: profile.id,
        period_date: savingDate,
        notes: snapshotNotes.trim() || null,
        score: snapshotScore,
        score_detail: snapshotScoreDetail,
      }

      let entryId
      if (isUpdate) {
        // UPDATE only this specific entry by its PK.
        // Extra .eq('user_id') is a server-side safety net.
        const { error } = await supabase
          .from('tracker_entries')
          .update(entryPayload)
          .eq('id', existingId)
          .eq('user_id', profile.id)
        if (error) throw error
        entryId = existingId
      } else {
        // INSERT — unique constraint (tracker_id, user_id, period_date) prevents duplicates
        const { data, error } = await supabase
          .from('tracker_entries')
          .insert(entryPayload)
          .select('id')
          .single()
        if (error) throw error
        entryId = data.id
      }

      // Upsert field values scoped to this single entry
      const vals = Object.entries(snapshotValues).map(([field_key, val]) => ({
        entry_id: entryId,
        field_key,
        value_text: String(val ?? ''),
      }))
      if (vals.length) {
        const { error: valErr } = await supabase
          .from('tracker_field_values')
          .upsert(vals, { onConflict: 'entry_id,field_key' })
        if (valErr) throw valErr
      }

      // Update local state without any full reload (no blink, no mount/unmount)
      const savedEntry = {
        id: entryId,
        period_date: savingDate,
        notes: entryPayload.notes,
        score: entryPayload.score,
      }
      setExistingEntry(savedEntry)
      setEntries((prev) => {
        const filtered = prev.filter((en) => en.id !== entryId && en.period_date !== savingDate)
        return [savedEntry, ...filtered].sort((a, b) => b.period_date.localeCompare(a.period_date))
      })

      toast.success('Entry saved', snapshotScore != null ? `Score: ${snapshotScore}/100` : '')
    } catch (e) {
      toast.error('Could not save entry', e.message)
    } finally {
      setSaving(false)
    }
  }

  // Initial config load — show loader only if tracker config not yet ready
  if (configLoading) return <div className="p-8 text-center text-slate-400">Loading tracker…</div>
  if (!tracker) return <div className="p-8 text-center text-slate-400">Tracker not found.</div>

  const recentWithoutSelected = entries.filter((e) => e.period_date !== selectedDate).slice(0, 7)

  const grad = colorToGradient(tracker.color)

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* ── Hero header ── */}
      <div className={cn('relative overflow-hidden rounded-3xl', 'bg-gradient-to-br', grad)}>
        <div className="pointer-events-none absolute -top-12 -right-12 w-52 h-52 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-8 w-40 h-40 rounded-full bg-black/10 blur-2xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative px-5 pt-4 pb-5">
          {/* Back + settings row */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold transition"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <Can permission="trackers.manage">
              <button
                onClick={() => navigate('settings')}
                className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
              >
                <Settings className="w-4 h-4 text-white" />
              </button>
            </Can>
          </div>
          {/* Icon + name */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/25 ring-1 ring-white/40 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold text-white/60 uppercase tracking-widest mb-0.5 capitalize">{tracker.cadence} tracker</p>
              <h1 className="text-2xl font-extrabold text-white leading-tight">{tracker.name}</h1>
              {tracker.description && (
                <p className="text-sm text-white/70 mt-0.5">{tracker.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── View tabs — pill switcher ── */}
      <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-2xl">
        {[
          { key: 'today',  label: 'Today',   icon: Calendar },
          { key: 'table',  label: 'Table',   icon: Table2 },
          { key: 'card',   label: 'Card',    icon: Award },
          { key: 'trend',  label: 'Trend',   icon: TrendingUp },
        ].map((t) => {
          const TabIcon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200',
                view === t.key
                  ? 'bg-white text-saffron-600 elev-1 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {view === 'table' && (
        <TrackerSpreadsheet
          tracker={tracker}
          fields={fields}
          groups={groups}
          rules={rules}
          calculatedColumns={calculatedColumns}
          orgId={org?.id}
          userId={profile?.id}
        />
      )}

      {view === 'card' && (
        <WeeklySadhanaCard
          tracker={tracker}
          fields={fields}
          groups={groups}
          rules={rules}
          calculatedColumns={calculatedColumns}
          orgId={org?.id}
          userId={profile?.id}
          devoteeName={profile?.display_name ?? profile?.spiritual_name}
        />
      )}

      {view === 'trend' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <TrendingUp className="w-4 h-4 text-saffron-500" />
              {tracker.score_label ?? 'Score'} Trend
            </div>
          </CardHeader>
          <CardBody>
            <TrackerTrendChart entries={entries} color={tracker.color ?? '#f97316'} />
          </CardBody>
        </Card>
      )}

      {view === 'today' && (
      <>
      {/* Date navigator + entry form */}
      <Card>
        <CardHeader border>
          {/* Date navigator strip */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving || dateLoading}
              onClick={() => setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-saffron-100 text-slate-500 hover:text-saffron-600 flex items-center justify-center transition flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <label className={cn('flex-1 relative cursor-pointer group', (saving || dateLoading) && 'pointer-events-none opacity-60')}>
              <div className="flex flex-col items-center justify-center bg-saffron-50 hover:bg-saffron-100 border border-saffron-200 rounded-2xl px-3 py-2.5 transition">
                <span className="text-[10px] font-bold text-saffron-400 uppercase tracking-widest">
                  {isToday(parseISO(selectedDate)) ? 'Today' : format(parseISO(selectedDate), 'EEEE')}
                </span>
                <span className="text-base font-extrabold text-slate-800 leading-tight">
                  {format(parseISO(selectedDate), 'd MMM yyyy')}
                </span>
              </div>
              <input
                type="date"
                value={selectedDate}
                disabled={saving || dateLoading}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </label>

            <button
              type="button"
              disabled={saving || dateLoading}
              onClick={() => setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-saffron-100 text-slate-500 hover:text-saffron-600 flex items-center justify-center transition flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            {dateLoading
              ? <Loader2 className="w-4 h-4 animate-spin text-slate-300 flex-shrink-0" />
              : existingEntry && <Badge variant="tulasi" dot className="flex-shrink-0">Saved</Badge>
            }
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            {fields.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {field.label}
                    {field.is_required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {field.help_text && (
                    <span className="text-xs text-slate-400">{field.help_text}</span>
                  )}
                </div>
                <FieldInput
                  field={field}
                  value={fieldValues[field.key]}
                  onChange={(val) => setFieldValues((prev) => ({ ...prev, [field.key]: val }))}
                />
              </div>
            ))}

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Notes <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes…"
              />
            </div>

            {/* Score preview */}
            {tracker.has_scoring && scored?.score != null && (
              <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-saffron-50 to-orange-50 border border-saffron-100">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-saffron-600 uppercase tracking-wide mb-0.5">{tracker.score_label ?? 'Score'}</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold text-saffron-600">{scored.score}</span>
                    <span className="text-sm text-slate-400 font-medium">/100</span>
                  </div>
                </div>
                {/* Bar */}
                <div className="flex-1 h-2 rounded-full bg-saffron-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-saffron-400 to-orange-500 transition-all duration-700"
                    style={{ width: `${scored.score}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={saving} className="flex-1" size="lg">
                {existingEntry ? 'Update Entry' : 'Submit Entry'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                icon={Share2}
                onClick={handleShareWhatsApp}
                size="lg"
                title="Share on WhatsApp"
              />
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Recent history */}
      {recentWithoutSelected.length > 0 && (
        <Card>
          <CardHeader border>
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-slate-400" />
              </span>
              <p className="text-sm font-bold text-slate-800">Recent History</p>
            </div>
          </CardHeader>
          <CardBody className="!pt-2">
            <div className="divide-y divide-slate-50">
            {recentWithoutSelected.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">{format(parseISO(e.period_date), 'EEE, dd MMM')}</span>
                </div>
                {e.score != null ? (
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          e.score >= 70 ? 'bg-gradient-to-r from-tulasi-400 to-emerald-500'
                            : e.score >= 40 ? 'bg-gradient-to-r from-saffron-400 to-orange-500'
                            : 'bg-gradient-to-r from-rose-400 to-red-500'
                        )}
                        style={{ width: `${e.score}%` }}
                      />
                    </div>
                    <Badge variant={e.score >= 70 ? 'tulasi' : e.score >= 40 ? 'saffron' : 'red'}>
                      {e.score}/100
                    </Badge>
                  </div>
                ) : (
                  <Badge variant="default">—</Badge>
                )}
              </div>
            ))}
            </div>
          </CardBody>
        </Card>
      )}
      </>
      )}

      {showShare && (
        <WhatsAppShareModal
          title="Share Today's Sadhana"
          initialMessage={shareMessage}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

export default function TrackersPage() {
  return (
    <Routes>
      <Route index element={<TrackerList />} />
      <Route path="new" element={<TrackerBuilder />} />
      <Route path=":trackerId/settings" element={<TrackerSettings />} />
      <Route path=":trackerId" element={<TrackerDetail />} />
    </Routes>
  )
}
