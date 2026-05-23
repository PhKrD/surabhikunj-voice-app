import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { GitBranch, Crown, Shield, Star, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'

const levelConfig = {
  vmc: { label: 'VMC', icon: Crown, color: 'bg-saffron-500 text-white', order: 0 },
  oc: { label: 'Office Committee', icon: Shield, color: 'bg-lotus-500 text-white', order: 1 },
  hod: { label: 'Head of Department', icon: Star, color: 'bg-tulasi-600 text-white', order: 2 },
  dept_leader: { label: 'Department Leader', icon: Users, color: 'bg-blue-500 text-white', order: 3 },
  counsellor: { label: 'Counsellors', icon: Users, color: 'bg-indigo-500 text-white', order: 4 },
  devotee: { label: 'Devotees', icon: Users, color: 'bg-slate-400 text-white', order: 5 },
}

export default function HierarchyPage() {
  const { profile } = useAuthStore()
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('org_positions')
        .select('*, profile:profile_id(spiritual_name, avatar_url, role)')
        .eq('voice_id', profile.voice_id)
        .order('sort_order')
      setPositions(data ?? [])
      setLoading(false)
    }
    load()
  }, [profile])

  const grouped = Object.entries(levelConfig)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([level, cfg]) => ({
      level,
      cfg,
      items: positions.filter((p) => p.level === level),
    }))
    .filter((g) => g.items.length > 0)

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <GitBranch className="w-5 h-5 text-saffron-500" />
        <h2 className="text-lg font-bold text-slate-800">Organizational Structure</h2>
      </div>

      {positions.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <GitBranch className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No hierarchy configured yet.</p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="relative">
        {/* Vertical connector line */}
        {grouped.length > 1 && (
          <div className="absolute left-5 top-8 bottom-8 w-0.5 bg-gradient-to-b from-saffron-200 via-lotus-200 to-slate-200" />
        )}

        <div className="space-y-4">
          {grouped.map(({ level, cfg, items }, idx) => {
            const LevelIcon = cfg.icon
            return (
              <motion.div
                key={level}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-start gap-4">
                  {/* Level indicator */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm z-10 ${cfg.color}`}>
                    <LevelIcon className="w-5 h-5" />
                  </div>

                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{cfg.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {items.map((pos) => (
                        <div
                          key={pos.id}
                          className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2 shadow-sm"
                        >
                          {pos.profile ? (
                            <>
                              <Avatar
                                name={pos.profile.spiritual_name}
                                url={pos.profile.avatar_url}
                                size="sm"
                              />
                              <div>
                                <p className="text-sm font-semibold text-slate-800 leading-tight">
                                  {pos.profile.spiritual_name}
                                </p>
                                <p className="text-xs text-slate-400">{pos.title}</p>
                              </div>
                            </>
                          ) : (
                            <div>
                              <p className="text-sm font-semibold text-slate-500">{pos.title}</p>
                              <p className="text-xs text-slate-400 italic">Vacant</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
