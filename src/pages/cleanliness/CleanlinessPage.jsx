import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { cn, isAdmin } from '@/lib/utils'

const statusConfig = {
  done: { label: 'Done', icon: CheckCircle2, color: 'text-tulasi-600', bg: 'bg-tulasi-50 border-tulasi-200' },
  not_done: { label: 'Not Done', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-200' },
  partial: { label: 'Partial', icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-50 border-yellow-200' },
}

export default function CleanlinessPage() {
  const { profile } = useAuthStore()
  const [areas, setAreas] = useState([])
  const [myAreas, setMyAreas] = useState([])
  const [logs, setLogs] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const today = new Date().toISOString().split('T')[0]
  const admin = isAdmin(profile?.role)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      setLoading(true)

      // My assigned areas
      const { data: assignments } = await supabase
        .from('cleaning_assignments')
        .select('*, cleaning_areas(*)')
        .eq('profile_id', profile.id)
      setMyAreas(assignments?.map((a) => a.cleaning_areas).filter(Boolean) ?? [])

      // Today's logs for my areas
      const areaIds = assignments?.map((a) => a.area_id) ?? []
      if (areaIds.length > 0) {
        const { data: todayLogs } = await supabase
          .from('cleaning_logs')
          .select('*')
          .in('area_id', areaIds)
          .eq('profile_id', profile.id)
          .eq('log_date', today)
        const logMap = {}
        todayLogs?.forEach((l) => { logMap[l.area_id] = l })
        setLogs(logMap)
      }

      // All areas if admin
      if (admin) {
        const { data: allAreas } = await supabase
          .from('cleaning_areas')
          .select('*')
          .eq('voice_id', profile.voice_id)
          .eq('is_active', true)
          .order('name')
        setAreas(allAreas ?? [])
      }

      setLoading(false)
    }
    load()
  }, [profile, admin, today])

  const markStatus = async (area, status) => {
    setSaving((s) => ({ ...s, [area.id]: true }))
    const payload = {
      voice_id: profile.voice_id,
      area_id: area.id,
      profile_id: profile.id,
      log_date: today,
      status,
    }
    const { data } = await supabase
      .from('cleaning_logs')
      .upsert(payload, { onConflict: 'area_id,profile_id,log_date' })
      .select()
      .single()
    if (data) setLogs((l) => ({ ...l, [area.id]: data }))
    setSaving((s) => ({ ...s, [area.id]: false }))
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
        <div>
          <h3 className="text-base font-semibold text-slate-700 mb-3">All Areas Overview</h3>
          <Card>
            <CardBody>
              <div className="space-y-2">
                {areas.map((area) => (
                  <div key={area.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{area.name}</p>
                      {area.floor && <p className="text-xs text-slate-400">{area.floor}</p>}
                    </div>
                    <Badge variant="default">Monitoring</Badge>
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
