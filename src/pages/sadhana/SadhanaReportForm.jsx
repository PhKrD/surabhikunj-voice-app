import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Send, MessageCircle, Save, Clock, Moon, Sun, BookOpen, Headphones, Heart, Star, AlertCircle } from 'lucide-react'
import Button from '@/components/ui/Button'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import { calculateSadhanaScore, generateWhatsAppMessage } from '@/lib/sadhanaScoring'
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

  useEffect(() => {
    if (!profile?.voice_id) return undefined
    let active = true
    supabase
      .from('sadhana_score_config')
      .select('config')
      .eq('voice_id', profile.voice_id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setScoreConfig(data?.config ?? null)
      })
    return () => {
      active = false
    }
  }, [profile?.voice_id])

  const scores = useMemo(() => calculateSadhanaScore(form, scoreConfig), [form, scoreConfig])

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setQueuedOffline(false)
    const scoreData = calculateSadhanaScore(form, scoreConfig)
    const payload = {
      ...form,
      profile_id: profile.id,
      voice_id: profile.voice_id,
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
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: 'Japa', val: scores.score_japa, max: 30 },
              { label: 'Sleep', val: scores.score_sleep, max: 20 },
              { label: 'Reading', val: scores.score_reading, max: 15 },
              { label: 'Hearing', val: scores.score_hearing, max: 15 },
              { label: 'Seva', val: scores.score_seva, max: 10 },
              { label: 'Attend.', val: scores.score_attendance, max: 10 },
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
            <NumberInput value={form.reading_min} onChange={(v) => set('reading_min', v)} suffix="min" max={480} />
          </FieldRow>

          <FieldRow icon={Headphones} label="HR — Hearing (minutes)">
            <NumberInput value={form.hearing_min} onChange={(v) => set('hearing_min', v)} suffix="min" max={480} />
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
