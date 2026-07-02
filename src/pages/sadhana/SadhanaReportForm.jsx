import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Send, MessageCircle, Save, Clock, Moon, Sun, BookOpen, Headphones, Heart, Star, AlertCircle, GraduationCap, Sparkles } from 'lucide-react'
import Button from '@/components/ui/Button'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import { calculateSadhanaScore, generateWhatsAppMessage } from '@/lib/sadhanaScoring'
import { calculateDynamicSadhanaScore } from '@/lib/sadhanaConfigScoring'
import { cn } from '@/lib/utils'
import useAuthStore from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { enqueueSadhanaReport } from '@/lib/offlineQueue'

const defaultForm = {
  report_date: new Date().toISOString().split('T')[0],
  to_bed_time: '',
  wake_up_time: '',
  day_rest_min: 0,
  japa_time: '',
  japa_rounds: 0,
  reading_min: 0,
  hearing_min: 0,
  mangal_arti: false,
  morning_class: false,
  seva_hours: 0,
  studies_min: 0,
  cleanliness_done: false,
  notes: '',
}

function FieldRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-50 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-saffron-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-saffron-500" />
      </div>
      <div className="flex-1">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
        {children}
      </div>
    </div>
  )
}

function TimeInput({ value, onChange, placeholder }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full sm:w-40 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 focus:border-transparent transition"
    />
  )
}

function NumberInput({ value, onChange, min = 0, max, suffix }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 focus:border-transparent transition"
      />
      {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-150',
        value
          ? 'bg-tulasi-50 border-tulasi-200 text-tulasi-700'
          : 'bg-slate-50 border-slate-200 text-slate-500'
      )}
    >
      <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center', value ? 'border-tulasi-500 bg-tulasi-500' : 'border-slate-300')}>
        {value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      {label}
    </button>
  )
}

export default function SadhanaReportForm({ onSaved }) {
  const { profile } = useAuthStore()
  const [form, setForm] = useState(defaultForm)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [queuedOffline, setQueuedOffline] = useState(false)
  const [scoreConfig, setScoreConfig] = useState(null)
  const [scoringRules, setScoringRules] = useState([])
  const [hearingSources, setHearingSources] = useState([])
  const [readingTypes, setReadingTypes] = useState([])
  const [hearingSourceId, setHearingSourceId] = useState('')
  const [readingTypeId, setReadingTypeId] = useState('')

  useEffect(() => {
    if (!profile?.voice_id) return undefined
    let active = true
    
    // Fetch scoring configuration, rules, and sources
    Promise.all([
      supabase
        .from('sadhana_score_config')
        .select('config')
        .eq('voice_id', profile.voice_id)
        .maybeSingle(),
      supabase
        .from('sadhana_scoring_rules')
        .select('*')
        .eq('voice_id', profile.voice_id)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('hearing_sources')
        .select('*')
        .eq('voice_id', profile.voice_id)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('reading_types')
        .select('*')
        .eq('voice_id', profile.voice_id)
        .eq('is_active', true)
        .order('display_order')
    ])
      .then(([configRes, rulesRes, hearingRes, readingRes]) => {
        if (!active) return
        setScoreConfig(configRes.data?.config ?? null)
        // Missing tables (before migration) return an error object — treat as empty
        setScoringRules(rulesRes.error ? [] : (rulesRes.data ?? []))
        setHearingSources(hearingRes.error ? [] : (hearingRes.data ?? []))
        setReadingTypes(readingRes.error ? [] : (readingRes.data ?? []))
      })
      .catch((err) => {
        console.error('[sadhana] config fetch failed:', err)
      })

    return () => {
      active = false
    }
  }, [profile?.voice_id])

  const scores = useMemo(() => {
    // Use dynamic scoring if rules are configured, otherwise fall back to old system
    if (scoringRules.length > 0) {
      return calculateDynamicSadhanaScore(form, scoringRules)
    }
    return calculateSadhanaScore(form, scoreConfig)
  }, [form, scoreConfig, scoringRules])

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setQueuedOffline(false)
    const scoreData = scoringRules.length > 0 
      ? calculateDynamicSadhanaScore(form, scoringRules)
      : calculateSadhanaScore(form, scoreConfig)
    const payload = {
      ...form,
      profile_id: profile.id,
      voice_id: profile.voice_id,
      hearing_source_id: hearingSourceId || null,
      reading_type_id: readingTypeId || null,
      ...scoreData,
    }
    const queueForLater = () => {
      enqueueSadhanaReport(payload)
      setQueuedOffline(true)
      setSaved(true)
      onSaved?.()
      setTimeout(() => setSaved(false), 3000)
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        queueForLater()
        return
      }
      const { error: err } = await supabase
        .from('sadhana_reports')
        .upsert(payload, { onConflict: 'profile_id,report_date' })

      if (err) throw err
      setSaved(true)
      onSaved?.()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        queueForLater()
      } else {
        setError(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleWhatsApp = () => {
    const msg = generateWhatsAppMessage(form, profile?.spiritual_name)
    const encoded = encodeURIComponent(msg)
    window.open(`https://wa.me/?text=${encoded}`, '_blank')
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Date picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-600">Report Date:</label>
        <input
          type="date"
          value={form.report_date}
          max={new Date().toISOString().split('T')[0]}
          onChange={(e) => set('report_date', e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition"
        />
      </div>

      {/* Live Score Preview */}
      {scores && (
        <motion.div
          key={scores.score}
          initial={{ scale: 0.98 }}
          animate={{ scale: 1 }}
          className="bg-gradient-to-r from-saffron-500 to-saffron-600 rounded-2xl p-4 text-white"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium opacity-80">Live Score Preview</p>
            <div className="text-3xl font-bold">{scores.score.toFixed(1)}<span className="text-lg opacity-70">/100</span></div>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {[
              { label: 'Japa', val: scores.score_japa, max: 30 },
              { label: 'Sleep', val: scores.score_sleep, max: 20 },
              { label: 'Reading', val: scores.score_reading, max: 15 },
              { label: 'Hearing', val: scores.score_hearing, max: 15 },
              { label: 'Seva', val: scores.score_seva, max: 10 },
              { label: 'Attend.', val: scores.score_attendance, max: 10 },
              { label: 'Studies', val: scores.score_studies ?? 0, max: 10 },
              { label: 'Clean.', val: scores.score_cleanliness ?? 0, max: 5 },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-lg font-bold">{s.val}</div>
                <div className="text-xs opacity-70">{s.label}/{s.max}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Form fields */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-slate-700">Daily Sadhana Details</h3>
        </CardHeader>
        <CardBody className="pt-0">
          <FieldRow icon={Moon} label="TB — To Bed Time">
            <TimeInput value={form.to_bed_time} onChange={(v) => set('to_bed_time', v)} />
          </FieldRow>

          <FieldRow icon={Sun} label="WU — Wake Up Time">
            <TimeInput value={form.wake_up_time} onChange={(v) => set('wake_up_time', v)} />
          </FieldRow>

          <FieldRow icon={Clock} label="DR — Day Rest (minutes)">
            <NumberInput value={form.day_rest_min} onChange={(v) => set('day_rest_min', v)} suffix="min" max={480} />
          </FieldRow>

          <FieldRow icon={Star} label="JP — Japa: Rounds & Completion Time">
            <div className="flex flex-wrap gap-3 items-center">
              <NumberInput value={form.japa_rounds} onChange={(v) => set('japa_rounds', v)} suffix="rounds" max={32} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Completed by:</span>
                <TimeInput value={form.japa_time} onChange={(v) => set('japa_time', v)} />
              </div>
            </div>
          </FieldRow>

          <FieldRow icon={BookOpen} label="RD — Reading (minutes)">
            <div className="space-y-2">
              <NumberInput value={form.reading_min} onChange={(v) => set('reading_min', v)} suffix="min" max={480} />
              {readingTypes.length > 0 && (
                <select
                  value={readingTypeId}
                  onChange={(e) => setReadingTypeId(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition"
                >
                  <option value="">Select reading type...</option>
                  {readingTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              )}
            </div>
          </FieldRow>

          <FieldRow icon={Headphones} label="HR — Hearing (minutes)">
            <div className="space-y-2">
              <NumberInput value={form.hearing_min} onChange={(v) => set('hearing_min', v)} suffix="min" max={480} />
              {hearingSources.length > 0 && (
                <select
                  value={hearingSourceId}
                  onChange={(e) => setHearingSourceId(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition"
                >
                  <option value="">Select hearing source...</option>
                  {hearingSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.abbreviation || source.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </FieldRow>

          <FieldRow icon={Heart} label="MA & MC — Attendance">
            <div className="flex gap-3 flex-wrap">
              <Toggle value={form.mangal_arti} onChange={(v) => set('mangal_arti', v)} label="Mangal Arti" />
              <Toggle value={form.morning_class} onChange={(v) => set('morning_class', v)} label="Morning Class" />
            </div>
          </FieldRow>

          <FieldRow icon={Send} label="Seva (hours)">
            <NumberInput value={form.seva_hours} onChange={(v) => set('seva_hours', v)} suffix="hrs" max={24} />
          </FieldRow>

          <FieldRow icon={GraduationCap} label="Studies (minutes)">
            <NumberInput value={form.studies_min} onChange={(v) => set('studies_min', v)} suffix="min" max={480} />
          </FieldRow>

          <FieldRow icon={Sparkles} label="Cleanliness">
            <Toggle value={form.cleanliness_done} onChange={(v) => set('cleanliness_done', v)} label="Cleaning done today" />
          </FieldRow>

          <div className="mt-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Any additional notes for your counsellor..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition resize-none"
            />
          </div>
        </CardBody>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {queuedOffline && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-600">Saved offline — it will sync automatically when you're back online.</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} loading={saving} icon={Save} variant="primary">
          {saved ? 'Saved!' : 'Save Report'}
        </Button>
        <Button onClick={handleWhatsApp} variant="tulasi" icon={MessageCircle}>
          Share via WhatsApp
        </Button>
      </div>

      <p className="text-xs text-slate-400">
        * Saving also stores the report in your counsellor's dashboard automatically.
      </p>
    </div>
  )
}
