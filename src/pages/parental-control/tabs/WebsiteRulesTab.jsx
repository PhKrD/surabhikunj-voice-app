import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Globe, Ban, CheckCircle, AlertTriangle } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listWebsiteRules, createWebsiteRule, deleteWebsiteRule } from '@/lib/parentalControlApi'

const ACTION_META = {
  allow: { label: 'Allowed', variant: 'tulasi', icon: CheckCircle },
  block: { label: 'Blocked', variant: 'red', icon: Ban },
}

export default function WebsiteRulesTab({ childId }) {
  const toast = useToastStore()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ domain: '', action: 'block' })

  const load = useCallback(async () => {
    try {
      setRules(await listWebsiteRules(childId))
    } catch (error) {
      toast.error('Could not load website rules', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const handleCreate = async () => {
    const domain = form.domain.trim().toLowerCase()
    if (!domain) {
      setFormError('Domain is required (e.g. youtube.com).')
      return
    }
    if (!domain.includes('.')) {
      setFormError('Enter a valid domain (e.g. youtube.com, not "youtube").')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await createWebsiteRule({ childId, domain, action: form.action })
      setForm({ domain: '', action: 'block' })
      setShowForm(false)
      await load()
      toast.success('Website rule added')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not add rule', error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteWebsiteRule(id)
      await load()
      toast.success('Rule removed')
    } catch (error) {
      toast.error('Could not remove rule', error.message)
    }
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-3">
        <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 leading-relaxed">
          <span className="font-semibold">Not yet enforced.</span> Rules saved here are stored but
          nothing on the device currently blocks these domains — there is no on-device filtering
          mechanism yet. Do not rely on this to actually restrict browsing. See
          PLATFORM_LIMITATIONS.md for what full support requires.
        </p>
      </div>

      <div className="flex justify-end">
        <Button size="sm" icon={showForm ? Trash2 : Plus} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : 'Add rule'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">Domain</span>
              <input
                value={form.domain}
                onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                placeholder="youtube.com"
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Action</span>
              <select
                value={form.action}
                onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              >
                <option value="block">Block</option>
                <option value="allow">Allow (whitelist)</option>
              </select>
            </label>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { setForm({ domain: '', action: 'block' }); setShowForm(false) }}>
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
          <div className="text-center py-10 px-6">
            <Globe className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No website rules yet</p>
            <p className="text-xs text-slate-400 mt-1">Add domains to block or allow access.</p>
          </div>
        )}
        {rules.map((rule) => {
          const meta = ACTION_META[rule.action] ?? ACTION_META.block
          const Icon = meta.icon
          return (
            <Card key={rule.id}>
              <CardBody className="py-3.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{rule.domain}</p>
                  <p className="text-xs text-slate-400">{rule.device_id ? 'Device-specific' : 'All devices'}</p>
                </div>
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <button
                  onClick={() => handleDelete(rule.id)}
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
