import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Clock, ShieldAlert, Moon, Sun, Smartphone, Pencil, Search, X, Info } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, listInstalledApps } from '@/lib/parentalControlApi'
import { isProtectedPackage } from '@/lib/protectedPackages'
import { cn } from '@/lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ACTIONS = [
  { value: 'block_all', label: 'Block everything', icon: ShieldAlert, desc: 'Lock the device — only calls, VOICE and any apps you pick below stay available' },
  { value: 'allow_list_only', label: 'Only selected apps', icon: Sun, desc: 'Homework mode: only the apps you pick below can be used' },
  { value: 'block_internet', label: 'Internet off', icon: Smartphone, desc: 'Apps still work, no network (needs the one-time VPN permission)' },
]

const TEMPLATES = [
  { name: 'Bedtime', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '21:00', endTime: '07:00', action: 'block_all', icon: Moon },
  { name: 'School', daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '15:00', action: 'block_all', icon: Sun },
  { name: 'Homework', daysOfWeek: [1, 2, 3, 4, 5], startTime: '17:00', endTime: '19:00', action: 'allow_list_only', icon: Clock },
]

/** Multi-select of installed apps for a routine's always-allowed list. */
function AppPicker({ apps, selected, onChange }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return apps
      .filter((a) => !isProtectedPackage(a.package_name))
      .filter((a) => !query || a.app_name?.toLowerCase().includes(query) || a.package_name.toLowerCase().includes(query))
      .sort((a, b) => {
        const sa = selected.includes(a.package_name) ? 0 : 1
        const sb = selected.includes(b.package_name) ? 0 : 1
        if (sa !== sb) return sa - sb
        return (a.app_name || a.package_name).localeCompare(b.app_name || b.package_name)
      })
      .slice(0, 60)
  }, [apps, q, selected])

  const toggle = (pkg) => onChange(selected.includes(pkg) ? selected.filter((p) => p !== pkg) : [...selected, pkg])

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search apps to allow..."
          className="w-full px-3 py-2 pl-9 rounded-lg border border-[var(--border-color)] text-sm"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((pkg) => {
            const app = apps.find((a) => a.package_name === pkg)
            return (
              <span key={pkg} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs">
                {app?.app_name || pkg}
                <button type="button" onClick={() => toggle(pkg)} className="hover:text-red-600"><X className="w-3 h-3" /></button>
              </span>
            )
          })}
        </div>
      )}
      <div className="max-h-44 overflow-y-auto border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)]">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-token p-3">{apps.length === 0 ? "No apps reported from the child's device yet." : 'No apps match.'}</p>
        )}
        {filtered.map((app) => {
          const on = selected.includes(app.package_name)
          return (
            <button
              key={app.package_name}
              type="button"
              onClick={() => toggle(app.package_name)}
              className={cn('w-full flex items-center gap-2 px-3 py-2 text-left text-sm', on ? 'bg-indigo-50' : 'hover:bg-[var(--surface-muted)]')}
            >
              <span className={cn('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0', on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300')}>
                {on && <span className="w-2 h-2 bg-white rounded-sm" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-primary-token">{app.app_name || app.package_name}</span>
                <span className="block truncate text-[11px] text-muted-token font-mono">{app.package_name}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatTime(time) {
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
}

const emptyForm = {
  name: '',
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: '21:00',
  endTime: '07:00',
  action: 'block_all',
  alwaysAllowedPackages: [],
}

export default function SchedulesTab({ childId }) {
  const toast = useToastStore()
  const [schedules, setSchedules] = useState([])
  const [installedApps, setInstalledApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    try {
      const [rows, apps] = await Promise.all([listSchedules(childId), listInstalledApps(childId).catch(() => [])])
      setSchedules(rows)
      // dedupe across devices
      const seen = {}
      for (const a of apps) if (!seen[a.package_name]) seen[a.package_name] = a
      setInstalledApps(Object.values(seen))
    } catch (error) {
      toast.error('Could not load routines', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const openForm = (sched = null, template = null) => {
    if (sched) {
      setEditing(sched)
      setForm({
        name: sched.name,
        daysOfWeek: sched.days_of_week,
        startTime: sched.start_time?.slice(0, 5) ?? '21:00',
        endTime: sched.end_time?.slice(0, 5) ?? '07:00',
        action: sched.action,
        // Migration 61 auto-appends telecom/dialer/VOICE — hide those from the
        // picker, they are always allowed regardless.
        alwaysAllowedPackages: (sched.always_allowed_packages || []).filter((p) => !isProtectedPackage(p)),
      })
    } else {
      setEditing(null)
      setForm(template ? { ...emptyForm, ...template } : emptyForm)
    }
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Give the routine a name')
      return
    }
    if (form.daysOfWeek.length === 0) {
      toast.error('Pick at least one day')
      return
    }
    const alwaysAllowed = form.alwaysAllowedPackages

    try {
      if (editing) {
        await updateSchedule(editing.id, {
          name: form.name,
          days_of_week: form.daysOfWeek,
          start_time: form.startTime,
          end_time: form.endTime,
          action: form.action,
          always_allowed_packages: alwaysAllowed,
        })
        toast.success('Schedule updated')
      } else {
        await createSchedule({
          childId,
          name: form.name,
          daysOfWeek: form.daysOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          action: form.action,
          alwaysAllowedPackages: alwaysAllowed,
        })
        toast.success('Schedule created')
      }
      setShowForm(false)
      await load()
    } catch (error) {
      toast.error('Could not save schedule', error.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this schedule?')) return
    try {
      await deleteSchedule(id)
      toast.success('Schedule deleted')
      await load()
    } catch (error) {
      toast.error('Could not delete schedule', error.message)
    }
  }

  const toggleDay = (day) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter((d) => d !== day) : [...prev.daysOfWeek, day],
    }))
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  const toggleEnabled = async (sched) => {
    try {
      await updateSchedule(sched.id, { is_enabled: sched.is_enabled === false })
      await load()
    } catch (error) {
      toast.error('Could not update routine', error.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary-token">Routines</h3>
          <p className="text-xs text-muted-token">Named time windows — bedtime, school, homework — with their own rules.</p>
        </div>
        <Button size="sm" onClick={() => openForm()}>
          <Plus className="w-4 h-4 mr-1.5" /> New routine
        </Button>
      </div>

      {schedules.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TEMPLATES.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.name}
                onClick={() => openForm(null, t)}
                className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-[var(--border-color)] text-left hover:border-indigo-400 hover:bg-indigo-50/40"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary-token">{t.name}</p>
                  <p className="text-[11px] text-muted-token">{formatTime(t.startTime)} – {formatTime(t.endTime)}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-6 px-6">
          <Clock className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">No routines yet</p>
          <p className="text-xs text-muted-token mt-1">Start from a template above, or paint hours directly in the Restricted times tab.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((sched) => {
            const actionDef = ACTIONS.find((a) => a.value === sched.action)
            const Icon = actionDef?.icon || Clock
            const enabled = sched.is_enabled !== false
            const picked = (sched.always_allowed_packages || []).filter((p) => !isProtectedPackage(p))
            return (
              <Card key={sched.id} className={cn(!enabled && 'opacity-60')}>
                <CardBody className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-primary-token">{sched.name}</p>
                        <p className="text-xs text-secondary-token mt-0.5">
                          {DAYS.filter((_, i) => sched.days_of_week.includes(i)).join(', ')} · {formatTime(sched.start_time)} – {formatTime(sched.end_time)}
                        </p>
                        <p className="text-xs text-muted-token mt-0.5">
                          {actionDef?.label}
                          {picked.length > 0 && ` · ${picked.length} app${picked.length === 1 ? '' : 's'} allowed`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleEnabled(sched)}
                        className={`w-10 h-5 rounded-full transition-colors relative mr-1 ${enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                        title={enabled ? 'On' : 'Off'}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                      </button>
                      <button onClick={() => openForm(sched)} className="p-1.5 rounded-lg text-muted-token hover:text-indigo-600 hover:bg-indigo-50">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(sched.id)} className="p-1.5 rounded-lg text-muted-token hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <CardBody className="p-5 space-y-4">
              <h3 className="text-lg font-semibold text-primary-token">{editing ? 'Edit routine' : 'New routine'}</h3>

              <div>
                <label className="block text-xs font-medium text-primary-token mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Bedtime"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-primary-token mb-1.5">Days</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((day, i) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        form.daysOfWeek.includes(i) ? 'bg-indigo-500 text-white' : 'bg-[var(--surface-muted)] text-secondary-token hover:bg-slate-200'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-primary-token mb-1.5">Start time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-primary-token mb-1.5">End time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-primary-token mb-1.5">Action</label>
                <div className="grid grid-cols-1 gap-2">
                  {ACTIONS.map((act) => {
                    const Icon = act.icon
                    return (
                      <button
                        key={act.value}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, action: act.value }))}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-colors ${
                          form.action === act.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-[var(--border-color)] hover:border-slate-300 text-primary-token'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <div>
                          <span className="font-medium">{act.label}</span>
                          <p className="text-xs opacity-70">{act.desc}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {form.action === 'block_all' || form.action === 'allow_list_only' ? (
                <div>
                  <label className="block text-xs font-medium text-primary-token mb-1.5">
                    {form.action === 'allow_list_only' ? 'Apps allowed during this routine' : 'Apps still allowed (optional)'}
                  </label>
                  <AppPicker
                    apps={installedApps}
                    selected={form.alwaysAllowedPackages}
                    onChange={(list) => setForm((prev) => ({ ...prev, alwaysAllowedPackages: list }))}
                  />
                  <p className="text-xs text-muted-token mt-1.5 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Calls, the dialer and VOICE itself are always allowed and don't need to be picked.
                  </p>
                </div>
              ) : null}

              <div className="flex gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowForm(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={save} className="flex-1">
                  {editing ? 'Save' : 'Create'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
