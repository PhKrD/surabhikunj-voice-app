import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { ROLES, ROLE_COLORS, formatDate, scoreBg } from '@/lib/utils'

export default function CounsellorPage() {
  const { profile } = useAuthStore()
  const isCounsellor = ['counsellor', 'sadhana_incharge', 'admin', 'vmc', 'oc'].includes(profile?.role)

  const [counsellees, setCounsellees] = useState([])
  const [counsellor, setCounsellor] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      setLoading(true)
      if (isCounsellor) {
        const { data } = await supabase
          .from('profiles')
          .select('*, sadhana_reports(score, report_date)')
          .eq('counsellor_id', profile.id)
          .eq('is_active', true)
          .order('spiritual_name')
        setCounsellees(data ?? [])
      } else if (profile.counsellor_id) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile.counsellor_id)
          .single()
        setCounsellor(data)
      }
      setLoading(false)
    }
    load()
  }, [profile, isCounsellor])

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>
  }

  if (isCounsellor) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">My Counsellees ({counsellees.length})</h2>
        </div>

        {counsellees.length === 0 && (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-10 text-slate-400">
                <Users className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No counsellees assigned yet.</p>
              </div>
            </CardBody>
          </Card>
        )}

        {counsellees.map((c) => {
          const latestReport = c.sadhana_reports?.sort(
            (a, b) => new Date(b.report_date) - new Date(a.report_date)
          )[0]
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardBody className="py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.spiritual_name} url={c.avatar_url} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{c.spiritual_name}</p>
                      {c.legal_name && <p className="text-xs text-slate-400">{c.legal_name}</p>}
                      <div className="flex gap-2 mt-1">
                        <Badge className={ROLE_COLORS[c.role]}>{ROLES[c.role]}</Badge>
                        {c.initiated && <Badge variant="saffron">Initiated</Badge>}
                      </div>
                    </div>
                    <div className="text-right">
                      {latestReport ? (
                        <>
                          <div className={`text-sm font-bold px-2 py-1 rounded-lg ${scoreBg(latestReport.score ?? 0)}`}>
                            {(latestReport.score ?? 0).toFixed(1)}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{formatDate(latestReport.report_date)}</p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400">No reports</p>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h2 className="text-lg font-bold text-slate-800">My Counsellor</h2>
      {!profile?.counsellor_id ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <Users className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No counsellor assigned yet.</p>
              <p className="text-xs text-slate-300 mt-1">Please contact your administrator.</p>
            </div>
          </CardBody>
        </Card>
      ) : counsellor ? (
        <Card>
          <CardBody className="py-5">
            <div className="flex items-center gap-4">
              <Avatar name={counsellor.spiritual_name} url={counsellor.avatar_url} size="lg" />
              <div>
                <p className="font-bold text-slate-800 text-lg">{counsellor.spiritual_name}</p>
                {counsellor.legal_name && <p className="text-sm text-slate-500">{counsellor.legal_name}</p>}
                <Badge className={`${ROLE_COLORS[counsellor.role]} mt-1`}>{ROLES[counsellor.role]}</Badge>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}
