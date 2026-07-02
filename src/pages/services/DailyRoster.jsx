import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { formatTime } from '@/lib/utils'

// Manager-facing daily roster: view and manually assign/clear the devotees
// allocated to each service on a given date. Complements the auto-scheduler.
export default function DailyRoster({ voiceId, services, date, allocatedBy, reloadSignal }) {
  const toast = useToastStore()
  const [allocations, setAllocations] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!voiceId || !date) return
    setLoading(true)
    Promise.all([
      supabase
        .from('service_allocations')
        .select('id, service_id, profile_id, profile:profile_id(spiritual_name)')
        .eq('voice_id', voiceId)
        .eq('service_date', date),
      supabase
        .from('profiles')
        .select('id, spiritual_name')
        .eq('voice_id', voiceId)
        .eq('is_active', true)
        .order('spiritual_name', { ascending: true }),
    ])
      .then(([allocRes, memRes]) => {
        setAllocations(allocRes.data ?? [])
        setMembers(memRes.data ?? [])
      })
      .catch((e) => {
        toast.error('Could not load roster', e.message)
      })
      .finally(() => setLoading(false))
  }, [voiceId, date, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load, reloadSignal])

  const assign = async (service) => {
    const profileId = draft[service.id]
    if (!profileId) return
    if (allocations.some((a) => a.service_id === service.id && a.profile_id === profileId)) {
      toast.info('Already assigned')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('service_allocations').insert({
        voice_id: voiceId,
        service_id: service.id,
        profile_id: profileId,
        service_date: date,
        service_time: service.default_time || null,
        status: 'pending',
        allocated_by: allocatedBy,
      })
      if (error) throw error
      setDraft((d) => ({ ...d, [service.id]: '' }))
      toast.success('Devotee assigned')
      load()
    } catch (e) {
      toast.error('Could not assign', e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (allocationId) => {
    setBusy(true)
    try {
      const { error } = await supabase.from('service_allocations').delete().eq('id', allocationId)
      if (error) throw error
      setAllocations((prev) => prev.filter((a) => a.id !== allocationId))
      toast.success('Removed')
    } catch (e) {
      toast.error('Could not remove', e.message)
    } finally {
      setBusy(false)
    }
  }

  const byService = {}
  for (const a of allocations) {
    if (!byService[a.service_id]) byService[a.service_id] = []
    byService[a.service_id].push(a)
  }

  return (
    <Card>
      <CardBody className="py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Daily Roster</p>
          <span className="text-xs text-slate-400">{format(new Date(date + 'T00:00:00'), 'dd MMM yyyy')}</span>
        </div>
        {loading ? (
          <p className="text-sm text-slate-400">Loading roster…</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-slate-400">No services defined yet.</p>
        ) : (
          <div className="space-y-3">
            {services.map((service) => {
              const assigned = byService[service.id] ?? []
              const assignedIds = new Set(assigned.map((a) => a.profile_id))
              const available = members.filter((m) => !assignedIds.has(m.id))
              return (
                <div key={service.id} className="border-b border-slate-50 last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">{service.name}</p>
                    {service.default_time && (
                      <span className="text-xs text-slate-400">{formatTime(service.default_time)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {assigned.length === 0 && <span className="text-xs text-slate-400">Unassigned</span>}
                    {assigned.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-saffron-50 text-saffron-700 text-xs font-medium"
                      >
                        {a.profile?.spiritual_name ?? 'Member'}
                        <button
                          onClick={() => remove(a.id)}
                          disabled={busy}
                          className="hover:text-red-600"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      value={draft[service.id] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [service.id]: e.target.value }))}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="">Add devotee…</option>
                      {available.map((m) => (
                        <option key={m.id} value={m.id}>{m.spiritual_name}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={() => assign(service)} loading={busy} disabled={!draft[service.id]}>
                      Assign
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
