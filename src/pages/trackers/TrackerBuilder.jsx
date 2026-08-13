import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, X, BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'

const inputBase = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

const FIELD_TYPES = [
  { value: 'number', label: 'Number' },
  { value: 'time', label: 'Time' },
  { value: 'duration_min', label: 'Duration (minutes)' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Select' },
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long Text' },
]

const CADENCES = ['daily', 'weekly', 'monthly', 'on_demand']
const SUBMISSION_MODES = ['self', 'admin']

function slugify(label) {
  return String(label ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function emptyField() {
  return {
    uid: Math.random().toString(36).slice(2),
    label: '',
    field_type: 'number',
    unit: '',
    is_required: false,
  }
}

export default function TrackerBuilder() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { org } = useOrgStore()
  const toast = useToastStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cadence, setCadence] = useState('daily')
  const [submissionMode, setSubmissionMode] = useState('self')
  const [color, setColor] = useState('#f97316')
  const [icon, setIcon] = useState('BookOpen')
  const [fields, setFields] = useState([emptyField()])
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const orgId = org?.id ?? profile?.org_id

  const updateField = (uid, patch) => {
    setFields((prev) => prev.map((f) => (f.uid === uid ? { ...f, ...patch } : f)))
  }

  const addField = () => setFields((prev) => [...prev, emptyField()])

  const removeField = (uid) => {
    setFields((prev) => (prev.length > 1 ? prev.filter((f) => f.uid !== uid) : prev))
  }

  const buildFieldKeys = () => {
    const used = new Set()
    return fields.map((f) => {
      let base = slugify(f.label) || 'field'
      let key = base
      let n = 2
      while (used.has(key)) {
        key = `${base}_${n}`
        n += 1
      }
      used.add(key)
      return { ...f, key }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!name.trim() || name.trim().length < 2) {
      setFormError('Tracker name must be at least 2 characters.')
      return
    }
    if (fields.some((f) => !f.label.trim())) {
      setFormError('Every field needs a label.')
      return
    }
    if (!orgId) {
      setFormError('Could not determine your organization.')
      return
    }

    const keyedFields = buildFieldKeys()

    setSaving(true)
    let createdTrackerId = null
    try {
      const { data: trackerRow, error: trackerErr } = await supabase
        .from('tracker_definitions')
        .insert({
          org_id: orgId,
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || 'BookOpen',
          color: color || '#f97316',
          cadence,
          submission_mode: submissionMode,
          has_scoring: false,
          is_active: true,
          sort_order: 0,
        })
        .select('id')
        .single()

      if (trackerErr) throw trackerErr
      createdTrackerId = trackerRow.id

      const fieldRows = keyedFields.map((f, idx) => ({
        tracker_id: createdTrackerId,
        key: f.key,
        label: f.label.trim(),
        field_type: f.field_type,
        unit: f.unit?.trim() || null,
        is_required: f.is_required,
        sort_order: (idx + 1) * 10,
      }))

      const { error: fieldsErr } = await supabase.from('tracker_fields').insert(fieldRows)
      if (fieldsErr) throw fieldsErr

      toast.success('Tracker created')
      navigate(`/trackers/${createdTrackerId}`)
    } catch (err) {
      if (createdTrackerId) {
        await supabase.from('tracker_definitions').delete().eq('id', createdTrackerId)
      }
      setFormError(err.message)
      toast.error('Could not create tracker', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: color || '#f97316' }}
        >
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-lg font-bold text-slate-800">New Tracker</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold text-slate-700">Tracker Details</div>
          </CardHeader>
          <CardBody className="space-y-4">
            <label className="block">
              <span className="text-xs text-slate-500">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sadhana"
                className={`${inputBase} mt-1`}
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-500">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this tracker capture?"
                className={`${inputBase} mt-1 resize-none`}
              />
            </label>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-slate-500">Cadence</span>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value)}
                  className={`${inputBase} mt-1`}
                >
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>{c.replace('_', ' ')}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Submission Mode</span>
                <select
                  value={submissionMode}
                  onChange={(e) => setSubmissionMode(e.target.value)}
                  className={`${inputBase} mt-1`}
                >
                  {SUBMISSION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-slate-500">Color</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-14 h-10 mt-1 p-1 rounded-xl border border-slate-200"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Icon</span>
                <input
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="BookOpen"
                  className={`${inputBase} mt-1`}
                />
                <span className="text-xs text-slate-400">Any lucide-react icon name, e.g. BookOpen, ListChecks</span>
              </label>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Fields</div>
              <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addField}>
                Add Field
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {fields.map((field, idx) => (
              <div key={field.uid} className="p-3 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Field {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeField(field.uid)}
                    disabled={fields.length === 1}
                    className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-slate-500">Label</span>
                    <input
                      value={field.label}
                      onChange={(e) => updateField(field.uid, { label: e.target.value })}
                      placeholder="Japa Rounds"
                      className={`${inputBase} mt-1`}
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-slate-500">Field Type</span>
                    <select
                      value={field.field_type}
                      onChange={(e) => updateField(field.uid, { field_type: e.target.value })}
                      className={`${inputBase} mt-1`}
                    >
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft.value} value={ft.value}>{ft.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex items-end gap-4">
                  {!['boolean', 'textarea', 'select'].includes(field.field_type) && (
                    <label className="block flex-1">
                      <span className="text-xs text-slate-500">Unit</span>
                      <input
                        value={field.unit}
                        onChange={(e) => updateField(field.uid, { unit: e.target.value })}
                        placeholder="rounds, minutes…"
                        className={`${inputBase} mt-1`}
                      />
                    </label>
                  )}

                  <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={field.is_required}
                      onChange={(e) => updateField(field.uid, { is_required: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    Required
                  </label>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        {formError ? (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving} className="flex-1">
            Create Tracker
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
