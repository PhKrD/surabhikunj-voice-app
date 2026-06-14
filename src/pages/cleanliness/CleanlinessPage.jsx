import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { cn, isAdmin } from '@/lib/utils'
import useToastStore from '@/store/toastStore'

const statusConfig = {
  done: { label: 'Done', icon: CheckCircle2, color: 'text-tulasi-600', bg: 'bg-tulasi-50 border-tulasi-200' },
  not_done: { label: 'Not Done', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-200' },
  partial: { label: 'Partial', icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-50 border-yellow-200' },
}

export default function CleanlinessPage() {
  const { profile } = useAuthStore()
  const toast = useToastStore()
  const [areas, setAreas] = useState([])
  const [myAreas, setMyAreas] = useState([])
  const [devotees, setDevotees] = useState([])
  const [areaAssignments, setAreaAssignments] = useState({})
  const [logs, setLogs] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [creatingArea, setCreatingArea] = useState(false)
  const [assigningAreaId, setAssigningAreaId] = useState(null)
  const [areaDraft, setAreaDraft] = useState({ name: '', floor: '', description: '' })
  const today = new Date().toISOString().split('T')[0]
  const admin = isAdmin(profile?.role)

  useEffect(() => {
    if (!profile) return

    const load = async () => {
      setLoading(true)
      try {
        const { data: assignments, error: assignmentsError } = await supabase
          .from('cleaning_assignments')
          .select('area_id, profile_id, cleaning_areas(*)')
          .eq('profile_id', profile.id)

        if (assignmentsError) throw assignmentsError
        setMyAreas(assignments?.map((a) => a.cleaning_areas).filter(Boolean) ?? [])

        const areaIds = assignments?.map((a) => a.area_id) ?? []
        if (areaIds.length > 0) {
          const { data: todayLogs, error: logsError } = await supabase
            .from('cleaning_logs')
            .select('*')
            .in('area_id', areaIds)
            .eq('profile_id', profile.id)
            .eq('log_date', today)

          if (logsError) throw logsError

          const logMap = {}
          todayLogs?.forEach((l) => { logMap[l.area_id] = l })
          setLogs(logMap)
        } else {
          setLogs({})
        }

        if (admin) {
          const [{ data: allAreas, error: allAreasError }, { data: allDevotees, error: allDevoteesError }, { data: allAssignments, error: allAssignmentsError }] = await Promise.all([
            supabase
              .from('cleaning_areas')
              .select('*')
              .eq('voice_id', profile.voice_id)
              .eq('is_active', true)
              .order('name'),
            supabase
              .from('profiles')
              .select('id, spiritual_name')
              .eq('voice_id', profile.voice_id)
              .eq('is_active', true)
              .eq('role', 'devotee')
              .order('spiritual_name'),
            supabase
              .from('cleaning_assignments')
              .select('area_id, profile_id')
              .eq('voice_id', profile.voice_id),
          ])

          if (allAreasError) throw allAreasError
          if (allDevoteesError) throw allDevoteesError
          if (allAssignmentsError) throw allAssignmentsError

          setAreas(allAreas ?? [])
          setDevotees(allDevotees ?? [])

          const assignmentMap = {}
          allAssignments?.forEach((a) => {
            if (!assignmentMap[a.area_id]) {
              assignmentMap[a.area_id] = a.profile_id
            }
          })
          setAreaAssignments(assignmentMap)
        }
      } catch (error) {
        toast.error('Could not load cleanliness data', error.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile, admin, today, toast])

  const markStatus = async (area, status) => {
    setSaving((s) => ({ ...s, [area.id]: true }))
    try {
      const payload = {
        voice_id: profile.voice_id,
        area_id: area.id,
        profile_id: profile.id,
        log_date: today,
        status,
      }
      const { data, error } = await supabase
        .from('cleaning_logs')
        .upsert(payload, { onConflict: 'area_id,profile_id,log_date' })
        .select()
        .single()

      if (error) throw error
      if (data) setLogs((l) => ({ ...l, [area.id]: data }))
    } catch (error) {
      toast.error('Could not update cleaning status', error.message)
    } finally {
      setSaving((s) => ({ ...s, [area.id]: false }))
    }
  }

  const createArea = async () => {
    if (!profile || !areaDraft.name.trim()) return

    setCreatingArea(true)
    try {
      const payload = {
        voice_id: profile.voice_id,
        name: areaDraft.name.trim(),
        floor: areaDraft.floor.trim() || null,
        description: areaDraft.description.trim() || null,
        is_active: true,
      }

      const { data, error } = await supabase
        .from('cleaning_areas')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      setAreas((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setAreaDraft({ name: '', floor: '', description: '' })
      toast.success('Cleaning area created')
    } catch (error) {
      toast.error('Could not create cleaning area', error.message)
    } finally {
      setCreatingArea(false)
    }
  }

  const saveAreaAssignment = async (areaId) => {
    if (!profile) return

    const assigneeId = areaAssignments[areaId] || ''
    setAssigningAreaId(areaId)
    try {
      const { error: clearError } = await supabase
        .from('cleaning_assignments')
        .delete()
        .eq('voice_id', profile.voice_id)
        .eq('area_id', areaId)

      if (clearError) throw clearError

      if (assigneeId) {
        const { error: insertError } = await supabase
          .from('cleaning_assignments')
          .insert({
            voice_id: profile.voice_id,
            area_id: areaId,
            profile_id: assigneeId,
          })

        if (insertError) throw insertError
      }

      toast.success(assigneeId ? 'Assignment saved' : 'Assignment removed')
    } catch (error) {
      toast.error('Could not save assignment', error.message)
    } finally {
      setAssigningAreaId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* My assignments today */}
      <div>
        <h3 className="text-base font-semibold text-slate-700 mb-3">My Cleaning Areas Today</h3>
        {myAreas.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-8 text-slate-400">
                <Sparkles className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No cleaning areas assigned to you.</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {myAreas.map((area) => {
              const log = logs[area.id]
              const status = log?.status ?? null
              return (
                <motion.div key={area.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <Card>
                    <CardBody className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-800">{area.name}</p>
                          {area.floor && <p className="text-xs text-slate-400">{area.floor}</p>}
                          {area.description && <p className="text-xs text-slate-500 mt-0.5">{area.description}</p>}
                        </div>
                        {status && (() => {
                          const cfg = statusConfig[status]
                          const Icon = cfg.icon
                          return (
                            <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium', cfg.bg, cfg.color)}>
                              <Icon className="w-3.5 h-3.5" />
                              {cfg.label}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {Object.entries(statusConfig).map(([key, cfg]) => {
                          const CfgIcon = cfg.icon
                          return (
                            <button
                              key={key}
                              onClick={() => markStatus(area, key)}
                              disabled={saving[area.id]}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150',
                                status === key
                                  ? cn(cfg.bg, cfg.color)
                                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                              )}
                            >
                              <CfgIcon className="w-3.5 h-3.5" />
                              {cfg.label}
                            </button>
                          )
                        })}
                      </div>
                    </CardBody>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Admin: all areas overview */}
      {admin && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-slate-700">Area Management</h3>

          <Card>
            <CardBody className="space-y-3">
              <p className="text-sm font-semibold text-slate-700">Create Cleaning Area</p>
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  value={areaDraft.name}
                  onChange={(e) => setAreaDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Area name"
                  className="px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
                <input
                  value={areaDraft.floor}
                  onChange={(e) => setAreaDraft((prev) => ({ ...prev, floor: e.target.value }))}
                  placeholder="Floor"
                  className="px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
                <input
                  value={areaDraft.description}
                  onChange={(e) => setAreaDraft((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Description"
                  className="px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <Button size="sm" onClick={createArea} loading={creatingArea}>Add Area</Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="space-y-3">
                {areas.map((area) => (
                  <div key={area.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-slate-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">{area.name}</p>
                      {area.floor && <p className="text-xs text-slate-400">{area.floor}</p>}
                    </div>

                    <select
                      value={areaAssignments[area.id] ?? ''}
                      onChange={(e) => setAreaAssignments((prev) => ({ ...prev, [area.id]: e.target.value }))}
                      className="w-full sm:w-56 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                      disabled={assigningAreaId === area.id}
                    >
                      <option value="">Unassigned</option>
                      {devotees.map((d) => (
                        <option key={d.id} value={d.id}>{d.spiritual_name}</option>
                      ))}
                    </select>

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => saveAreaAssignment(area.id)}
                      loading={assigningAreaId === area.id}
                    >
                      Save
                    </Button>
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
