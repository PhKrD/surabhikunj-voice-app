import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listAppRules, createAppRule, deleteAppRule } from '@/lib/parentalControlApi'

const ACTION_META = {
  allow: { label: 'Allowed', variant: 'tulasi' },
  block: { label: 'Blocked', variant: 'red' },
  time_limit: { label: 'Time limit', variant: 'yellow' },
}

const defaultForm = { packageName: '', appName: '', action: 'block', dailyLimitMin: 60 }

export default function RulesTab({ childId }) {
  const toast = useToastStore()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await listAppRules(childId))
    } catch (error) {
      toast.error('Could not load app rules', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => loadRules(), 0)
    return () => clearTimeout(id)
  }, [loadRules])

  const resetForm = () => {
    setForm(defaultForm)
    setFormError('')
  }

  const handleCreate = async () => {
    if (!form.packageName.trim()) {
      setFormError('Package name is required (e.g. com.google.android.youtube).')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await createAppRule({
        childId,
        packageName: form.packageName.trim(),
        appName: form.appName.trim() || null,
        action: form.action,
        dailyLimitMin: Number(form.dailyLimitMin) || 60,
      })
      resetForm()
      setShowForm(false)
      await loadRules()
      toast.success('Rule created')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not create rule', error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (rule) => {
    try {
      await deleteAppRule(rule.id)
      await loadRules()
      toast.success('Rule removed')
    } catch (error) {
      toast.error('Could not remove rule', error.message)
    }
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          icon={showForm ? X : Plus}
          onClick={() => {
            if (showForm) resetForm()
            setShowForm((v) => !v)
          }}
        >
          {showForm ? 'Close' : 'Add Rule'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">Package name</span>
              <input
                value={form.packageName}
                onChange={(e) => setForm((f) => ({ ...f, packageName: e.target.value }))}
                placeholder="com.instagram.android"
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">App name (optional)</span>
              <input
                value={form.appName}
                onChange={(e) => setForm((f) => ({ ...f, appName: e.target.value }))}
                placeholder="Instagram"
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Action</span>
                <select
                  value={form.action}
                  onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="block">Block completely</option>
                  <option value="time_limit">Daily time limit</option>
                  <option value="allow">Always allow</option>
                </select>
              </label>
              {form.action === 'time_limit' && (
                <label className="block">
                  <span className="text-xs text-slate-500">Daily limit (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    value={form.dailyLimitMin}
                    onChange={(e) => setForm((f) => ({ ...f, dailyLimitMin: e.target.value }))}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                </label>
              )}
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false) }}>
                Cancel
              </Button>
              <Button size="sm" loading={saving} onClick={handleCreate}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="space-y-2">
        {rules.length === 0 && !showForm && (
          <p className="text-sm text-slate-400 text-center py-6">No app rules yet.</p>
        )}
        {rules.map((rule) => {
          const meta = ACTION_META[rule.action] ?? ACTION_META.block
          return (
            <Card key={rule.id}>
              <CardBody className="py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{rule.app_name || rule.package_name}</p>
                  <p className="text-xs text-slate-400 truncate font-mono">{rule.package_name}</p>
                </div>
                <Badge variant={meta.variant}>
                  {meta.label}{rule.action === 'time_limit' && rule.daily_limit_min ? ` · ${rule.daily_limit_min}m` : ''}
                </Badge>
                <button
                  onClick={() => handleDelete(rule)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
