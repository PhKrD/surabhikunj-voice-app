import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Clock, ShieldAlert, Moon, Sun, Smartphone } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '@/lib/parentalControlApi'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ACTIONS = [
  { value: 'block_all', label: 'Block all', icon: ShieldAlert, desc: 'Lock device completely' },
  { value: 'block_internet', label: 'Block internet', icon: Smartphone, desc: 'Allow apps, no network' },
  { value: 'allow_list_only', label: 'Allow list only', icon: Sun, desc: 'Only whitelisted apps' },
]

function formatTime(time) {
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
}

export default function SchedulesTab({ childId }) {
  const toast = useToastStore()
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const [form, setForm] = useState({
    name: '',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '21:00',
    endTime: '07:00',
    action: 'block_all',
    alwaysAllowedPackages: '',
  })

  const load = useCallback(async () => {
    try {
      setSchedules(await listSchedules(childId))
    } catch (error) {
      toast.error('Could not load schedules', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const openForm = (sched = null) => {
    if (sched) {
      setEditing(sched)
      setForm({
        name: sched.name,
        daysOfWeek: sched.days_of_week,
        startTime: sched.start_time,
        endTime: sched.end_time,
        action: sched.action,
        alwaysAllowedPackages: (sched.always_allowed_packages || []).join(', '),
      })
    } else {
      setEditing(null)
      setForm({
        name: '',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '21:00',
        endTime: '07:00',
        action: 'block_all',
        alwaysAllowedPackages: '',
      })
    }
    setShowForm(true)
  }

  const save = async () => {
    const alwaysAllowed = form.alwaysAllowedPackages
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

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

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Time-based schedules</h3>
        <Button size="sm" onClick={() => openForm()}>
          <Plus className="w-4 h-4 mr-1.5" /> Add schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-10 px-6">
          <Clock className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No schedules yet</p>
          <p className="text-xs text-slate-400 mt-1">Create time windows to automatically block apps or internet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((sched) => {
            const actionDef = ACTIONS.find((a) => a.value === sched.action)
            const Icon = actionDef?.icon || Clock
            return (
              <Card key={sched.id}>
                <CardBody className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{sched.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {DAYS.filter((_, i) => sched.days_of_week.includes(i)).join(', ')} · {formatTime(sched.start_time)} – {formatTime(sched.end_time)}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{actionDef?.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openForm(sched)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50">
                        <ShieldAlert className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(sched.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
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
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit schedule' : 'New schedule'}</h3>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Bedtime"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Days</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((day, i) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        form.daysOfWeek.includes(i) ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Start time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">End time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Action</label>
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
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
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
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Always-allowed packages (optional)</label>
                  <input
                    type="text"
                    value={form.alwaysAllowedPackages}
                    onChange={(e) => setForm((prev) => ({ ...prev, alwaysAllowedPackages: e.target.value }))}
                    placeholder="com.android.phone, com.google.android.dialer"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <p className="text-xs text-slate-400 mt-1">Comma-separated Android package names to always allow.</p>
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
