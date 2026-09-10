import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Plus, Trash2, Globe, Ban, CheckCircle, AlertTriangle, Settings as SettingsIcon, X } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import {
  listWebsiteRules, createWebsiteRule, deleteWebsiteRule,
  listCategoryRules, setCategoryRule,
  getWebsiteFilterSettings, updateWebsiteFilterSettings,
} from '@/lib/parentalControlApi'
import { WEB_CATEGORIES } from '@/lib/webCategories'

const ACTION_META = {
  allow: { label: 'Allowed', variant: 'tulasi', icon: CheckCircle },
  alert: { label: 'Alert', variant: 'yellow', icon: AlertTriangle },
  block: { label: 'Blocked', variant: 'red', icon: Ban },
}

const ACTION_SELECT_CLASS = {
  block: 'bg-red-50 border-red-200 text-red-700',
  alert: 'bg-amber-50 border-amber-200 text-amber-700',
  allow: 'bg-emerald-50 border-emerald-200 text-emerald-700',
}

function CategoryRow({ category, action, onChange }) {
  const Icon = Icons[category.icon] ?? Globe
  const effective = action ?? category.defaultAction
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--border-color)] last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="w-4.5 h-4.5 text-secondary-token" />
        <span className="text-sm text-primary-token">{category.label}</span>
      </div>
      <select
        value={effective}
        onChange={(e) => onChange(category.key, e.target.value)}
        className={`text-sm font-medium rounded-lg border px-2.5 py-1.5 ${ACTION_SELECT_CLASS[effective] ?? ACTION_SELECT_CLASS.allow}`}
      >
        <option value="allow">Allowed</option>
        <option value="alert">Alert me</option>
        <option value="block">Blocked</option>
      </select>
    </div>
  )
}

function SettingsModal({ settings, onClose, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)

  const toggle = (key) => setForm((f) => ({ ...f, [key]: !f[key] }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const rows = [
    {
      key: 'block_unsupported_browsers',
      title: 'Block unsupported browsers',
      hint: 'Remove the risk of my child accessing unsafe content on browsers VOICE cannot monitor/filter (anything other than Chrome, Firefox, Samsung Internet, Edge, Opera, Brave, Mi Browser, DuckDuckGo).',
    },
    {
      key: 'block_unknown_websites',
      title: 'Block unknown websites',
      hint: 'Remove the risk of my child accessing uncategorized websites (anything not in an allowed category or an explicit allow rule below).',
    },
    {
      key: 'enforce_safe_search',
      title: 'Enforce Safe Search',
      hint: 'Remove potentially harmful content from Google/Bing/DuckDuckGo/YouTube search results.',
    },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardBody className="p-5 space-y-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-primary-token">Settings</h3>
            <button onClick={onClose} className="p-1 rounded-lg text-muted-token hover:bg-[var(--surface-muted)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3 py-3 border-b border-[var(--border-color)]">
              <div>
                <p className="text-sm font-medium text-primary-token">{row.title}</p>
                <p className="text-xs text-muted-token mt-0.5">{row.hint}</p>
              </div>
              <button
                onClick={() => toggle(row.key)}
                className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${form[row.key] ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form[row.key] ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          ))}

          <p className="text-xs font-semibold text-muted-token uppercase tracking-wide pt-4 pb-1">Alerts</p>
          <div className="flex items-start justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-primary-token">Blocked websites</p>
              <p className="text-xs text-muted-token mt-0.5">Get an alert in Parental Control &gt; Alerts when my child tries to access a blocked website.</p>
            </div>
            <button
              onClick={() => toggle('alert_on_block')}
              className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${form.alert_on_block ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.alert_on_block ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="flex justify-end pt-3">
            <Button size="sm" loading={saving} onClick={handleSave}>Done</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export default function WebsiteRulesTab({ childId }) {
  const toast = useToastStore()
  const [subTab, setSubTab] = useState('categories')
  const [rules, setRules] = useState([])
  const [categoryRules, setCategoryRules] = useState({})
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ domain: '', action: 'block' })

  const load = useCallback(async () => {
    try {
      const [ruleRows, catRows, settingsRow] = await Promise.all([
        listWebsiteRules(childId),
        listCategoryRules(childId),
        getWebsiteFilterSettings(childId),
      ])
      setRules(ruleRows)
      setCategoryRules(Object.fromEntries(catRows.map((r) => [r.category_key, r.action])))
      setSettings(settingsRow)
    } catch (error) {
      toast.error('Could not load website filtering', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const handleCategoryChange = async (categoryKey, action) => {
    const category = WEB_CATEGORIES.find((c) => c.key === categoryKey)
    setCategoryRules((prev) => ({ ...prev, [categoryKey]: action }))
    try {
      // Storing the default explicitly is harmless and simplest; avoids a
      // second round-trip to decide whether to delete vs upsert.
      await setCategoryRule({ childId, categoryKey, action })
    } catch (error) {
      setCategoryRules((prev) => ({ ...prev, [categoryKey]: category?.defaultAction }))
      toast.error('Could not update category', error.message)
    }
  }

  const handleSaveSettings = async (patch) => {
    try {
      const updated = await updateWebsiteFilterSettings(childId, patch)
      setSettings(updated)
      toast.success('Settings saved')
    } catch (error) {
      toast.error('Could not save settings', error.message)
      throw error
    }
  }

  const handleToggleApplyFilters = async () => {
    if (!settings) return
    try {
      const updated = await updateWebsiteFilterSettings(childId, { apply_filters: !settings.apply_filters })
      setSettings(updated)
    } catch (error) {
      toast.error('Could not update', error.message)
    }
  }

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

  if (loading || !settings) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-3">
        <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 leading-relaxed">
          <span className="font-semibold">Best-effort, not guaranteed.</span> Blocking is enforced
          on-device via a local DNS filter (needs the one-time VPN permission from the device's setup
          checklist). Categories are a curated seed list of well-known domains, not a real-time
          content classifier — turn on "Block unknown websites" in Settings to default-deny anything
          uncategorized. Incognito/private browsing does NOT bypass this (it's network-level, not
          history-based). A browser hardwired to its own DNS-over-HTTPS provider outside our short
          mitigated list can still bypass it. See PLATFORM_LIMITATIONS.md for the full picture.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-[var(--surface-muted)] rounded-xl p-1">
          <button
            onClick={() => setSubTab('categories')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${subTab === 'categories' ? 'bg-indigo-600 text-white' : 'text-secondary-token'}`}
          >
            Categories
          </button>
          <button
            onClick={() => setSubTab('websites')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${subTab === 'websites' ? 'bg-indigo-600 text-white' : 'text-secondary-token'}`}
          >
            Websites
          </button>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-lg text-muted-token hover:text-indigo-600 hover:bg-indigo-50"
          title="Settings"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>

      {subTab === 'categories' && (
        <Card>
          <CardBody className="py-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)] mb-1">
              <span className="text-sm font-medium text-primary-token">Apply filters</span>
              <button
                onClick={handleToggleApplyFilters}
                className={`w-11 h-6 rounded-full transition-colors relative ${settings.apply_filters ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.apply_filters ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <p className="text-xs text-muted-token pb-2">Select a web category below to set filtering rules.</p>
            {WEB_CATEGORIES.map((category) => (
              <CategoryRow
                key={category.key}
                category={category}
                action={categoryRules[category.key]}
                onChange={handleCategoryChange}
              />
            ))}
          </CardBody>
        </Card>
      )}

      {subTab === 'websites' && (
        <>
          <div className="flex justify-end">
            <Button size="sm" icon={showForm ? Trash2 : Plus} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close' : 'Add website'}
            </Button>
          </div>

          {showForm && (
            <Card>
              <CardBody className="py-4 space-y-3">
                <label className="block">
                  <span className="text-xs text-secondary-token">Domain</span>
                  <input
                    value={form.domain}
                    onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                    placeholder="youtube.com"
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-secondary-token">Action</span>
                  <select
                    value={form.action}
                    onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                  >
                    <option value="block">Block</option>
                    <option value="alert">Allow, but alert me when visited</option>
                    <option value="allow">Allow (whitelist — overrides category blocks)</option>
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
                <Globe className="w-8 h-8 text-muted-token mx-auto mb-3" />
                <p className="text-sm font-medium text-secondary-token">No individual website rules yet</p>
                <p className="text-xs text-muted-token mt-1">Add specific domains to allow or block, on top of the category rules.</p>
              </div>
            )}
            {rules.map((rule) => {
              const meta = ACTION_META[rule.action] ?? ACTION_META.block
              const Icon = meta.icon
              return (
                <Card key={rule.id}>
                  <CardBody className="py-3.5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--surface-muted)] flex items-center justify-center">
                      <Icon className="w-4 h-4 text-secondary-token" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-primary-token truncate">{rule.domain}</p>
                      <p className="text-xs text-muted-token">{rule.device_id ? 'Device-specific' : 'All devices'}</p>
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 rounded-lg text-muted-token hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </CardBody>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {showSettings && (
        <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={handleSaveSettings} />
      )}
    </div>
  )
}
