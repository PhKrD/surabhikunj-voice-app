import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ListChecks, Clock, CheckCircle2, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { format, startOfWeek } from 'date-fns'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import { useCachedQuery } from '@/lib/useCachedQuery'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { cn, formatTime, isAdmin } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import DailyRoster from './DailyRoster'

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
  done: { label: 'Done', color: 'bg-tulasi-50 border-tulasi-200 text-tulasi-700' },
  missed: { label: 'Missed', color: 'bg-red-50 border-red-200 text-red-700' },
  excused: { label: 'Excused', color: 'bg-slate-50 border-slate-200 text-slate-600' },
}

export default function ServicesPage() {
  const { profile } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [updating, setUpdating] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState(null)
  const [preferenceSaving, setPreferenceSaving] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [focusedServiceId, setFocusedServiceId] = useState(null)
  const today = new Date().toISOString().split('T')[0]
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const [schedulerDate, setSchedulerDate] = useState(today)
  const [scheduling, setScheduling] = useState(false)
  const [rosterReload, setRosterReload] = useState(0)
  const [form, setForm] = useState({
    name: '',
    description: '',
    default_time: '',
    duration_min: 30,
    instructions: '',
    is_recurring: false,
  })
  const canManage = profile?.role === 'im' || isAdmin(profile?.role)
  const linkedServiceId = location.state?.referenceId
  const serviceRefs = useRef({})

  useEffect(() => {
    if (!linkedServiceId) return

    const id = setTimeout(() => {
      setFocusedServiceId(linkedServiceId)
      const node = serviceRefs.current[linkedServiceId]
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      navigate('/services', { replace: true })
    }, 120)

    return () => clearTimeout(id)
  }, [linkedServiceId, navigate])

  useEffect(() => {
    if (!focusedServiceId) return

    const id = setTimeout(() => {
      setFocusedServiceId(null)
    }, 3000)

    return () => clearTimeout(id)
  }, [focusedServiceId])

  const { data, loading, refetch } = useCachedQuery(
    profile ? `services:${profile.id}:${today}:${weekStart}` : null,
    async () => {
      const [allocRes, servicesRes, prefRes] = await Promise.all([
        supabase
          .from('service_allocations')
          .select('*, services(name, description, instructions)')
          .eq('profile_id', profile.id)
          .gte('service_date', today)
          .order('service_date', { ascending: true })
          .order('service_time', { ascending: true })
          .limit(20),
        supabase
          .from('services')
          .select('*')
          .eq('voice_id', profile.voice_id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('service_preferences')
          .select('service_id, preference')
          .eq('profile_id', profile.id)
          .eq('week_start', weekStart)
      ])
      
      if (allocRes.error) throw allocRes.error
      if (servicesRes.error) throw servicesRes.error
      if (prefRes.error) throw prefRes.error
      
      const prefMap = {}
      ;(prefRes.data ?? []).forEach((p) => {
        prefMap[p.service_id] = p.preference
      })
      
      return {
        allocations: allocRes.data ?? [],
        masterServices: servicesRes.data ?? [],
        preferences: prefMap
      }
    }
  )

  const allocations = data?.allocations ?? []
  const masterServices = data?.masterServices ?? []
  const preferences = data?.preferences ?? {}

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      default_time: '',
      duration_min: 30,
      instructions: '',
      is_recurring: false,
    })
    setEditingId(null)
    setFormError('')
  }

  const createOrUpdateService = async () => {
    if (!profile) return
    if (!form.name.trim()) {
      setFormError('Service name is required.')
      return
    }

    setFormError('')
    setSaving(true)

    try {
      const payload = {
        voice_id: profile.voice_id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        default_time: form.default_time || null,
        duration_min: Number(form.duration_min) || null,
        instructions: form.instructions.trim() || null,
        is_recurring: form.is_recurring,
        is_active: true,
      }

      const query = editingId
        ? supabase.from('services').update(payload).eq('id', editingId)
        : supabase.from('services').insert(payload)

      const { data: result, error } = await query.select().single()

      if (error) {
        setFormError(error.message)
        toast.error('Could not save service', error.message)
        return
      }

      if (!editingId && result) {
        const { data: recipients, error: recipientsError } = await supabase
          .from('profiles')
          .select('id')
          .eq('voice_id', profile.voice_id)
          .eq('is_active', true)

        if (recipientsError) {
          toast.error('Service created, but notifications failed', recipientsError.message)
        } else if (recipients?.length) {
          const { error: notificationsError } = await supabase.from('notifications').insert(
            recipients.map((member) => ({
              voice_id: profile.voice_id,
              profile_id: member.id,
              title: 'New service created',
              body: `${result.name} has been added to service master.`,
              type: 'service',
              reference_id: result.id,
            }))
          )

          if (notificationsError) {
            toast.error('Service created, but notifications failed', notificationsError.message)
          }
        }
      }

      toast.success(editingId ? 'Service updated' : 'Service created')
      resetForm()
      setShowForm(false)
      await refetch()
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not save service', error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (service) => {
    setEditingId(service.id)
    setShowForm(true)
    setFormError('')
    setForm({
      name: service.name ?? '',
      description: service.description ?? '',
      default_time: service.default_time ?? '',
      duration_min: service.duration_min ?? 30,
      instructions: service.instructions ?? '',
      is_recurring: service.is_recurring ?? false,
    })
  }

  const archiveService = async (service) => {
    const ok = window.confirm(`Archive service "${service.name}"?`)
    if (!ok) return

    setArchivingId(service.id)
    try {
      const { error } = await supabase
        .from('services')
        .update({ is_active: false })
        .eq('id', service.id)

      if (error) {
        toast.error('Could not archive service', error.message)
        return
      }

      toast.success('Service archived', '', {
        actionLabel: 'Undo',
        action: async () => {
          const { error: restoreError } = await supabase
            .from('services')
            .update({ is_active: true })
            .eq('id', service.id)

          if (restoreError) {
            toast.error('Could not restore service', restoreError.message)
            return
          }

          await refetch()
          toast.info('Service restored')
        },
      })
      await refetch()
    } catch (error) {
      toast.error('Could not archive service', error.message)
    } finally {
      setArchivingId(null)
    }
  }

  const markDone = async (id) => {
    setUpdating((u) => ({ ...u, [id]: true }))
    try {
      const { data, error } = await supabase
        .from('service_allocations')
        .update({ status: 'done' })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        toast.error('Could not mark service done', error.message)
        return
      }

      if (data) {
        await refetch()
      }
    } catch (error) {
      toast.error('Could not mark service done', error.message)
    } finally {
      setUpdating((u) => ({ ...u, [id]: false }))
    }
  }

  const savePreference = async (serviceId, preferenceValue) => {
    if (!profile) return

    setPreferenceSaving((prev) => ({ ...prev, [serviceId]: true }))
    try {
      const payload = {
        profile_id: profile.id,
        service_id: serviceId,
        week_start: weekStart,
        preference: preferenceValue,
      }

      const { error } = await supabase
        .from('service_preferences')
        .upsert(payload, { onConflict: 'profile_id,service_id,week_start' })

      if (error) throw error

      await refetch()
      toast.success('Preference updated')
    } catch (error) {
      toast.error('Could not save preference', error.message)
    } finally {
      setPreferenceSaving((prev) => ({ ...prev, [serviceId]: false }))
    }
  }

  const runAutoScheduler = async () => {
    if (!profile || !canManage || !schedulerDate) return

    setScheduling(true)
    try {
      const scheduleWeekStart = format(startOfWeek(new Date(schedulerDate), { weekStartsOn: 1 }), 'yyyy-MM-dd')

      const { data: prefRows, error: prefError } = await supabase
        .from('service_preferences')
        .select('profile_id, service_id, preference')
        .eq('week_start', scheduleWeekStart)

      if (prefError) throw prefError

      const { data: existingAllocations, error: existingError } = await supabase
        .from('service_allocations')
        .select('service_id, profile_id')
        .eq('voice_id', profile.voice_id)
        .eq('service_date', schedulerDate)

      if (existingError) throw existingError

      const existingServiceIds = new Set((existingAllocations ?? []).map((a) => a.service_id))
      const usedProfileIds = new Set((existingAllocations ?? []).map((a) => a.profile_id))

      const grouped = {}
      ;(prefRows ?? []).forEach((row) => {
        if (!grouped[row.service_id]) grouped[row.service_id] = []
        grouped[row.service_id].push(row)
      })

      Object.values(grouped).forEach((rows) => {
        rows.sort((a, b) => b.preference - a.preference)
      })

      const inserts = []
      masterServices.forEach((service) => {
        if (existingServiceIds.has(service.id)) return

        const candidates = grouped[service.id] ?? []
        const pick = candidates.find((c) => !usedProfileIds.has(c.profile_id))
        if (!pick) return

        usedProfileIds.add(pick.profile_id)
        inserts.push({
          voice_id: profile.voice_id,
          service_id: service.id,
          profile_id: pick.profile_id,
          service_date: schedulerDate,
          service_time: service.default_time || null,
          status: 'pending',
          allocated_by: profile.id,
        })
      })

      if (inserts.length > 0) {
        const { error: insertError } = await supabase
          .from('service_allocations')
          .insert(inserts)

        if (insertError) throw insertError
      }

      await refetch()
      setRosterReload((n) => n + 1)
      toast.success(`Auto-scheduler completed (${inserts.length} allocations)`)
    } catch (error) {
      toast.error('Could not run auto-scheduler', error.message)
    } finally {
      setScheduling(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  const today_alloc = allocations.filter((a) => a.service_date === today)
  const upcoming = allocations.filter((a) => a.service_date > today)

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {canManage && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-700">Service Master</h3>
            <Button
              size="sm"
              icon={showForm ? X : Plus}
              onClick={() => {
                if (showForm) resetForm()
                setShowForm((v) => !v)
              }}
            >
              {showForm ? 'Close' : 'Add Service'}
            </Button>
          </div>

          <Card>
            <CardBody className="py-4 space-y-2">
              <p className="text-sm font-semibold text-slate-700">Weekly Auto Allocation</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="date"
                  value={schedulerDate}
                  onChange={(e) => setSchedulerDate(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
                <Button size="sm" onClick={runAutoScheduler} loading={scheduling}>
                  Auto-allocate from preferences
                </Button>
              </div>
              <p className="text-xs text-slate-400">Allocates one devotee per service for selected date based on weekly preferences.</p>
            </CardBody>
          </Card>

          <DailyRoster
            voiceId={profile.voice_id}
            services={masterServices}
            date={schedulerDate}
            allocatedBy={profile.id}
            reloadSignal={rosterReload}
          />

          {showForm && (
            <Card>
              <CardBody className="py-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">
                  {editingId ? 'Edit Service' : 'Create Service'}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-slate-500">Service Name</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">Default Time</span>
                    <input
                      type="time"
                      value={form.default_time}
                      onChange={(e) => setForm((f) => ({ ...f, default_time: e.target.value }))}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </label>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-slate-500">Duration (minutes)</span>
                    <input
                      type="number"
                      min={5}
                      value={form.duration_min}
                      onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={form.is_recurring}
                      onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))}
                    />
                    Recurring service
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs text-slate-500">Description</span>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-slate-500">Instructions</span>
                  <textarea
                    rows={2}
                    value={form.instructions}
                    onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none"
                  />
                </label>

                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={createOrUpdateService} loading={saving}>
                    {editingId ? 'Save Changes' : 'Create Service'}
                  </Button>
                  {editingId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        resetForm()
                        setShowForm(false)
                      }}
                    >
                      Cancel Edit
                    </Button>
                  ) : null}
                </div>
                {formError ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
                ) : null}
              </CardBody>
            </Card>
          )}

          {masterServices.length > 0 && (
            <Card>
              <CardBody className="py-4">
                <div className="space-y-2">
                  {masterServices.map((service) => (
                    <div
                      key={service.id}
                      ref={(el) => {
                        if (el) {
                          serviceRefs.current[service.id] = el
                        }
                      }}
                      className={cn(
                        'flex items-center justify-between py-2 border-b border-slate-50 last:border-0 rounded-lg px-2',
                        focusedServiceId === service.id
                          ? 'bg-saffron-50 border-saffron-200 transition-colors duration-300 animate-pulse'
                          : ''
                      )}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-700">{service.name}</p>
                        <p className="text-xs text-slate-400">
                          {service.default_time ? formatTime(service.default_time) : 'No default time'}
                          {service.duration_min ? ` • ${service.duration_min} min` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {service.is_recurring && <Badge variant="blue">Recurring</Badge>}
                        <button
                          onClick={() => startEdit(service)}
                          disabled={archivingId === service.id}
                          className="p-1 rounded-md text-slate-400 hover:text-saffron-600 hover:bg-saffron-50"
                          title="Edit service"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => archiveService(service)}
                          disabled={archivingId === service.id}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Archive service"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {!canManage && masterServices.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-slate-700 mb-3">My Weekly Service Preferences</h3>
          <Card>
            <CardBody>
              <div className="space-y-2">
                {masterServices.map((service) => {
                  const current = preferences[service.id]
                  return (
                    <div key={service.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-slate-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">{service.name}</p>
                        {service.description ? <p className="text-xs text-slate-400 line-clamp-1">{service.description}</p> : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[
                          { label: 'Prefer', value: 1, active: 'bg-tulasi-50 text-tulasi-700 border-tulasi-200' },
                          { label: 'Okay', value: 0, active: 'bg-saffron-50 text-saffron-700 border-saffron-200' },
                          { label: 'Avoid', value: -1, active: 'bg-red-50 text-red-700 border-red-200' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            onClick={() => savePreference(service.id, option.value)}
                            disabled={preferenceSaving[service.id]}
                            className={cn(
                              'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                              current === option.value
                                ? option.active
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Today */}
      <div>
        <h3 className="text-base font-semibold text-slate-700 mb-3">
          Today's Services — {format(new Date(), 'dd MMM yyyy')}
        </h3>
        {today_alloc.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-8 text-slate-400">
                <ListChecks className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No services assigned for today.</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {today_alloc.map((alloc) => (
              <motion.div key={alloc.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardBody className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-saffron-50 flex items-center justify-center flex-shrink-0">
                        <ListChecks className="w-5 h-5 text-saffron-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-slate-800">{alloc.services?.name}</p>
                          <div className={cn('px-2 py-0.5 rounded-lg border text-xs font-medium flex-shrink-0', statusConfig[alloc.status]?.color)}>
                            {statusConfig[alloc.status]?.label}
                          </div>
                        </div>
                        {alloc.service_time && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                            <Clock className="w-3 h-3" />
                            {formatTime(alloc.service_time)}
                          </div>
                        )}
                        {alloc.services?.instructions && (
                          <p className="text-xs text-slate-400 mt-1 line-clamp-2">{alloc.services.instructions}</p>
                        )}
                        {alloc.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="tulasi"
                            className="mt-2"
                            loading={updating[alloc.id]}
                            onClick={() => markDone(alloc.id)}
                            icon={CheckCircle2}
                          >
                            Mark Done
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-slate-700 mb-3">Upcoming Services</h3>
          <Card>
            <CardBody>
              <div className="space-y-3">
                {upcoming.map((alloc) => (
                  <div key={alloc.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">{alloc.services?.name}</p>
                      <p className="text-xs text-slate-400">
                        {format(new Date(alloc.service_date), 'dd MMM')}
                        {alloc.service_time && ` at ${formatTime(alloc.service_time)}`}
                      </p>
                    </div>
                    <Badge variant="default">{statusConfig[alloc.status]?.label}</Badge>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
