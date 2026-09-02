import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, X, Search, Smartphone as SmartphoneIcon, Clock, AlertCircle } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listAppRules, createAppRule, deleteAppRule, listInstalledApps, getAppUsageToday } from '@/lib/parentalControlApi'
import { isProtectedPackage, PROTECTED_PACKAGE_EXPLANATION } from '@/lib/protectedPackages'

const ACTION_META = {
  allow: { label: 'Allowed', variant: 'tulasi', icon: SmartphoneIcon },
  block: { label: 'Blocked', variant: 'red', icon: AlertCircle },
  time_limit: { label: 'Time limit', variant: 'yellow', icon: Clock },
}

const defaultForm = { packageName: '', appName: '', action: 'block', dailyLimitMin: 60 }

export default function RulesTab({ childId }) {
  const toast = useToastStore()
  const [rules, setRules] = useState([])
  const [installedApps, setInstalledApps] = useState([])
  const [appUsage, setAppUsage] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)
  const [searchQuery, setSearchQuery] = useState('')

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const [rulesData, appsData, usageData] = await Promise.all([
        listAppRules(childId),
        listInstalledApps(childId),
        getAppUsageToday(childId)
      ])
      setRules(rulesData)
      setInstalledApps(appsData)
      setAppUsage(usageData)
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
      setFormError('Please select an app from the list')
      return
    }
    // Client-side check for instant feedback. The database trigger
    // (supabase/61_policy_integrity.sql) is the real enforcement boundary —
    // this only avoids a confusing raw-SQL error round trip.
    if (form.action !== 'allow' && isProtectedPackage(form.packageName.trim())) {
      setFormError(PROTECTED_PACKAGE_EXPLANATION)
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
      // Surface the database's guardrails with a friendly message instead
      // of a raw Postgres error string:
      //  - trigger rejection (protected package)
      //  - unique-index violation (migration 61: duplicate child-wide rule)
      let friendly = error.message
      if (/protected and cannot be blocked/.test(error.message)) {
        friendly = PROTECTED_PACKAGE_EXPLANATION
      } else if (error.code === '23505' || /duplicate key/i.test(error.message)) {
        friendly = 'A rule for this app already exists. Delete the existing one first if you want to change it.'
      }
      setFormError(friendly)
      toast.error('Could not create rule', friendly)
    } finally {
      setSaving(false)
    }
  }

  const selectApp = (app) => {
    setForm((f) => ({
      ...f,
      packageName: app.package_name,
      appName: app.app_name,
    }))
    setSearchQuery('')
  }

  const filteredApps = installedApps
    .filter((app) => {
      const query = searchQuery.toLowerCase()
      return (
        app.app_name?.toLowerCase().includes(query) ||
        app.package_name?.toLowerCase().includes(query)
      )
    })
    // Protected apps (dialer, settings, launcher, the agent itself) are
    // hidden from the picker entirely when the action would block/limit
    // them — there is no legitimate reason to offer that choice.
    .filter((app) => form.action === 'allow' || !isProtectedPackage(app.package_name))

  const handleDelete = async (rule) => {
    try {
      await deleteAppRule(rule.id)
      await loadRules()
      toast.success('Rule removed')
    } catch (error) {
      toast.error('Could not remove rule', error.message)
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

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
              <span className="text-xs text-secondary-token">Select app</span>
              <div className="relative mt-1">
                <input
                  value={form.appName || searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for an app..."
                  className="w-full px-3 py-2.5 pl-10 rounded-xl border border-[var(--border-color)] text-sm"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
              </div>
            </label>

            {searchQuery && filteredApps.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-[var(--border-color)] rounded-xl">
                {filteredApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => selectApp(app)}
                    className="w-full px-3 py-2.5 text-left hover:bg-[var(--surface-muted)] border-b border-[var(--border-color)] last:border-0 flex items-center gap-2"
                  >
                    <SmartphoneIcon className="w-4 h-4 text-muted-token" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary-token truncate">{app.app_name}</p>
                      <p className="text-xs text-muted-token truncate font-mono">{app.package_name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {form.packageName && (
              <div className="bg-[var(--surface-muted)] rounded-xl px-3 py-2 flex items-center gap-2">
                <SmartphoneIcon className="w-4 h-4 text-secondary-token" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary-token truncate">{form.appName}</p>
                  <p className="text-xs text-muted-token truncate font-mono">{form.packageName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setForm((f) => ({ ...f, packageName: '', appName: '' })); setSearchQuery('') }}
                  className="p-1 rounded hover:bg-slate-200"
                >
                  <X className="w-4 h-4 text-muted-token" />
                </button>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Action</span>
                <select
                  value={form.action}
                  onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                >
                  <option value="block">Block completely</option>
                  <option value="time_limit">Daily time limit</option>
                  <option value="allow">Always allow</option>
                </select>
              </label>
              {form.action === 'time_limit' && (
                <label className="block">
                  <span className="text-xs text-secondary-token">Daily limit (minutes)</span>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={form.dailyLimitMin}
                      onChange={(e) => setForm((f) => ({ ...f, dailyLimitMin: e.target.value }))}
                      className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                      placeholder="e.g., 30"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {['15', '30', '60', '120'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, dailyLimitMin: preset }))}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-muted)] text-secondary-token"
                      >
                        {preset}m
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-token mt-2">
                    <Clock className="w-3 h-3 inline mr-1" />
                    App will be blocked after this daily usage time
                  </p>
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
          <div className="text-center py-10 px-6">
            <SmartphoneIcon className="w-8 h-8 text-muted-token mx-auto mb-3" />
            <p className="text-sm font-medium text-secondary-token">No app rules yet.</p>
            <p className="text-xs text-muted-token mt-1">
              {installedApps.length === 0 
                ? 'Apps will appear here once the child\'s device reports them.'
                : 'Click "Add Rule" to create your first app rule.'}
            </p>
          </div>
        )}
        {rules.map((rule) => {
          const meta = ACTION_META[rule.action] ?? ACTION_META.block
          const Icon = meta.icon
          const usage = appUsage.find(u => u.package_name === rule.package_name)
          const usedMinutes = usage ? Math.round(usage.total_foreground_ms / 60000) : 0
          const remainingMinutes = rule.action === 'time_limit' && rule.daily_limit_min 
            ? Math.max(0, rule.daily_limit_min - usedMinutes) 
            : null
          
          return (
            <Card key={rule.id}>
              <CardBody className="py-3.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--surface-muted)] flex items-center justify-center">
                  <Icon className="w-4 h-4 text-secondary-token" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-primary-token truncate">{rule.app_name || rule.package_name}</p>
                  <p className="text-xs text-muted-token truncate font-mono">{rule.package_name}</p>
                  
                  {rule.action === 'time_limit' && rule.daily_limit_min && (
                    <div className="mt-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-secondary-token">
                          {usedMinutes}m / {rule.daily_limit_min}m used
                        </span>
                        {remainingMinutes !== null && (
                          <span className={`font-medium ${remainingMinutes <= 5 ? 'text-red-600' : 'text-secondary-token'}`}>
                            ({remainingMinutes}m remaining)
                          </span>
                        )}
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                        <div 
                          className={`h-1.5 rounded-full transition-all ${
                            usedMinutes >= rule.daily_limit_min ? 'bg-red-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(100, (usedMinutes / rule.daily_limit_min) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  
                  {rule.action === 'time_limit' && remainingMinutes !== null && remainingMinutes <= 5 && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Time limit reached
                    </p>
                  )}
                </div>
                <Badge variant={meta.variant}>
                  {meta.label}
                </Badge>
                <button
                  onClick={() => handleDelete(rule)}
                  className="p-2 rounded-lg text-muted-token hover:text-red-600 hover:bg-red-50"
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
