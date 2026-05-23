import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Clock, MapPin, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { format, isToday, isTomorrow } from 'date-fns'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { cn, isAdmin } from '@/lib/utils'
import useToastStore from '@/store/toastStore'

const eventTypeColors = {
  program: 'bg-blue-50 border-blue-100 text-blue-700',
  festival: 'bg-saffron-50 border-saffron-100 text-saffron-700',
  service: 'bg-tulasi-50 border-tulasi-100 text-tulasi-700',
  meeting: 'bg-slate-50 border-slate-100 text-slate-700',
  other: 'bg-lotus-50 border-lotus-100 text-lotus-700',
}

function getDateLabel(dateStr) {
  const d = new Date(dateStr)
  if (isToday(d)) return { label: 'Today', color: 'bg-saffron-500 text-white' }
  if (isTomorrow(d)) return { label: 'Tomorrow', color: 'bg-tulasi-500 text-white' }
  return { label: format(d, 'dd MMM'), color: 'bg-slate-100 text-slate-600' }
}

export default function EventsPage() {
  const { profile } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [focusedEventId, setFocusedEventId] = useState(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_type: 'program',
    start_datetime: '',
    end_datetime: '',
    venue: '',
    is_mandatory: false,
    notify_all: true,
  })
  const admin = isAdmin(profile?.role)
  const linkedEventId = location.state?.referenceId
  const eventRefs = useRef({})

  useEffect(() => {
    if (!linkedEventId) return

    const id = setTimeout(() => {
      setFocusedEventId(linkedEventId)
      const node = eventRefs.current[linkedEventId]
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      navigate('/events', { replace: true })
    }, 120)

    return () => clearTimeout(id)
  }, [linkedEventId, events, navigate])

  useEffect(() => {
    if (!focusedEventId) return

    const id = setTimeout(() => {
      setFocusedEventId(null)
    }, 3000)

    return () => clearTimeout(id)
  }, [focusedEventId])

  const loadEvents = useCallback(async () => {
    if (!profile) {
      setEvents([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('voice_id', profile.voice_id)
        .eq('is_active', true)
        .gte('start_datetime', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('start_datetime', { ascending: true })
        .limit(30)

      if (error) throw error
      setEvents(data ?? [])
    } catch (error) {
      toast.error('Could not load events', error.message)
    } finally {
      setLoading(false)
    }
  }, [profile, toast])

  useEffect(() => {
    const id = setTimeout(() => {
      loadEvents()
    }, 0)
    return () => clearTimeout(id)
  }, [loadEvents])

  const resetForm = () => {
    setForm({
      title: '',
      description: '',
      event_type: 'program',
      start_datetime: '',
      end_datetime: '',
      venue: '',
      is_mandatory: false,
      notify_all: true,
    })
    setEditingId(null)
    setFormError('')
  }

  const createOrUpdateEvent = async () => {
    if (!profile) return
    if (!form.title.trim()) {
      setFormError('Title is required.')
      return
    }
    if (!form.start_datetime) {
      setFormError('Start date/time is required.')
      return
    }

    setFormError('')
    setSaving(true)

    try {
      const payload = {
        voice_id: profile.voice_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_type: form.event_type,
        start_datetime: new Date(form.start_datetime).toISOString(),
        end_datetime: form.end_datetime ? new Date(form.end_datetime).toISOString() : null,
        venue: form.venue.trim() || null,
        is_mandatory: form.is_mandatory,
        notify_all: form.notify_all,
        created_by: profile.id,
      }

      const query = editingId
        ? supabase.from('events').update(payload).eq('id', editingId)
        : supabase.from('events').insert(payload)

      const { data: result, error } = await query.select().single()

      if (error) {
        setFormError(error.message)
        toast.error('Could not save event', error.message)
        return
      }

      if (!editingId && result && form.notify_all) {
        const { data: recipients, error: recipientsError } = await supabase
          .from('profiles')
          .select('id')
          .eq('voice_id', profile.voice_id)
          .eq('is_active', true)

        if (recipientsError) {
          toast.error('Event created, but notifications failed', recipientsError.message)
        } else if (recipients?.length) {
          const { error: notificationsError } = await supabase.from('notifications').insert(
            recipients.map((member) => ({
              voice_id: profile.voice_id,
              profile_id: member.id,
              title: `New ${form.event_type}: ${result.title}`,
              body: result.description ?? 'A new event has been created.',
              type: 'event',
              reference_id: result.id,
            }))
          )

          if (notificationsError) {
            toast.error('Event created, but notifications failed', notificationsError.message)
          }
        }
      }

      toast.success(editingId ? 'Event updated' : 'Event created')
      resetForm()
      setShowForm(false)
      await loadEvents()
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not save event', error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (event) => {
    setEditingId(event.id)
    setFormError('')
    setShowForm(true)
    setForm({
      title: event.title ?? '',
      description: event.description ?? '',
      event_type: event.event_type ?? 'program',
      start_datetime: event.start_datetime ? event.start_datetime.slice(0, 16) : '',
      end_datetime: event.end_datetime ? event.end_datetime.slice(0, 16) : '',
      venue: event.venue ?? '',
      is_mandatory: event.is_mandatory ?? false,
      notify_all: event.notify_all ?? true,
    })
  }

  const archiveEvent = async (event) => {
    const ok = window.confirm(`Archive event "${event.title}"?`)
    if (!ok) return

    setArchivingId(event.id)
    try {
      const { error } = await supabase
        .from('events')
        .update({ is_active: false })
        .eq('id', event.id)

      if (error) {
        toast.error('Could not archive event', error.message)
        return
      }

      await loadEvents()
      toast.success('Event archived', '', {
        actionLabel: 'Undo',
        action: async () => {
          const { error: restoreError } = await supabase
            .from('events')
            .update({ is_active: true })
            .eq('id', event.id)

          if (restoreError) {
            toast.error('Could not restore event', restoreError.message)
            return
          }

          await loadEvents()
          toast.info('Event restored')
        },
      })
    } catch (error) {
      toast.error('Could not archive event', error.message)
    } finally {
      setArchivingId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Events & Festivals</h2>
        {admin && (
          <Button
            size="sm"
            icon={showForm ? X : Plus}
            onClick={() => {
              if (showForm) resetForm()
              setShowForm((v) => !v)
            }}
          >
            {showForm ? 'Close' : 'Add Event'}
          </Button>
        )}
      </div>

      {admin && showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">
              {editingId ? 'Edit Event' : 'Create Event'}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-xs text-slate-500">Title</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Event Type</span>
                <select
                  value={form.event_type}
                  onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="program">Program</option>
                  <option value="festival">Festival</option>
                  <option value="service">Service</option>
                  <option value="meeting">Meeting</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Venue</span>
                <input
                  value={form.venue}
                  onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Start</span>
                <input
                  type="datetime-local"
                  value={form.start_datetime}
                  onChange={(e) => setForm((f) => ({ ...f, start_datetime: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">End (optional)</span>
                <input
                  type="datetime-local"
                  value={form.end_datetime}
                  onChange={(e) => setForm((f) => ({ ...f, end_datetime: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
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

            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_mandatory}
                  onChange={(e) => setForm((f) => ({ ...f, is_mandatory: e.target.checked }))}
                />
                Mandatory
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.notify_all}
                  onChange={(e) => setForm((f) => ({ ...f, notify_all: e.target.checked }))}
                />
                Notify all members
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={createOrUpdateEvent} loading={saving}>
                {editingId ? 'Save Changes' : 'Create Event'}
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

      {events.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <CalendarDays className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No upcoming events.</p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="space-y-3">
        {events.map((event) => {
          const dateLabel = getDateLabel(event.start_datetime)
          const linked = focusedEventId && focusedEventId === event.id
          return (
            <motion.div
              key={event.id}
              ref={(el) => {
                if (el) {
                  eventRefs.current[event.id] = el
                }
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className={cn(
                event.is_mandatory ? 'border-saffron-200' : '',
                linked
                  ? 'ring-2 ring-saffron-300 border-saffron-300 transition-all duration-300 animate-pulse'
                  : ''
              )}>
                <CardBody className="py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                      <div className={cn('px-2 py-1 rounded-lg text-xs font-bold', dateLabel.color)}>
                        {dateLabel.label}
                      </div>
                      <p className="text-xs text-slate-400">
                        {format(new Date(event.start_datetime), 'h:mm a')}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-800">{event.title}</p>
                        <div className="flex gap-1.5 flex-shrink-0 items-center">
                          {event.is_mandatory && <Badge variant="saffron">Mandatory</Badge>}
                          <Badge className={eventTypeColors[event.event_type]}>{event.event_type}</Badge>
                          {admin ? (
                            <>
                              <button
                                onClick={() => startEdit(event)}
                                disabled={archivingId === event.id}
                                className="p-1 rounded-md text-slate-400 hover:text-saffron-600 hover:bg-saffron-50"
                                title="Edit event"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => archiveEvent(event)}
                                disabled={archivingId === event.id}
                                className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="Delete event"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {event.description && (
                        <p className="text-sm text-slate-500 mt-1 line-clamp-2">{event.description}</p>
                      )}
                      {event.venue && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-400">
                          <MapPin className="w-3 h-3" />
                          {event.venue}
                        </div>
                      )}
                      {event.end_datetime && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
                          <Clock className="w-3 h-3" />
                          Ends {format(new Date(event.end_datetime), 'h:mm a')}
                        </div>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
