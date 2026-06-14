import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import { ROLES, ROLE_COLORS, formatDate, scoreBg } from '@/lib/utils'
import useToastStore from '@/store/toastStore'

const COUNSELLOR_ROLES = ['counsellor', 'sadhana_incharge']
const ADMIN_ROLES = ['admin', 'vmc', 'oc']

export default function CounsellorPage() {
  const { profile, loginType } = useAuthStore()
  const toast = useToastStore()
  const isCounsellor = loginType === 'counsellor'
  const canManageAssignments = ADMIN_ROLES.includes(profile?.role)

  const [counsellees, setCounsellees] = useState([])
  const [counsellor, setCounsellor] = useState(null)
  const [counsellors, setCounsellors] = useState([])
  const [devotees, setDevotees] = useState([])
  const [draftAssignments, setDraftAssignments] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return

    const load = async () => {
      setLoading(true)

      try {
        if (isCounsellor) {
          const { data, error } = await supabase
            .from('profiles')
            .select('*, sadhana_reports(score, report_date)')
            .eq('counsellor_id', profile.id)
            .eq('is_active', true)
            .order('spiritual_name')

          if (error) throw error
          setCounsellees(data ?? [])
        } else if (canManageAssignments) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('id, spiritual_name, legal_name, avatar_url, role, counsellor_id')
            .eq('voice_id', profile.voice_id)
            .eq('is_active', true)
            .order('spiritual_name')

          if (profileError) throw profileError

          const rows = profileData ?? []
          const counsellorData = rows.filter((p) => COUNSELLOR_ROLES.includes(p.role))
          const devoteeData = rows.filter(
            (p) => p.id !== profile.id && !COUNSELLOR_ROLES.includes(p.role) && !ADMIN_ROLES.includes(p.role)
          )

          setCounsellors(counsellorData)
          setDevotees(devoteeData)
          setDraftAssignments(
            Object.fromEntries(devoteeData.map((d) => [d.id, d.counsellor_id ?? '']))
          )
        } else if (profile.counsellor_id) {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', profile.counsellor_id)
            .single()

          if (error) throw error
          setCounsellor(data)
        }
      } catch (error) {
        toast.error('Could not load counsellor data', error.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile, loginType, isCounsellor, canManageAssignments, toast])

  const saveAssignment = async (devotee) => {
    if (!profile) return

    setSavingId(devotee.id)
    try {
      const nextCounsellorId = draftAssignments[devotee.id] || null
      const { error } = await supabase
        .from('profiles')
        .update({ counsellor_id: nextCounsellorId })
        .eq('id', devotee.id)
        .eq('voice_id', profile.voice_id)

      if (error) throw error

      setDevotees((prev) => prev.map((d) => (d.id === devotee.id ? { ...d, counsellor_id: nextCounsellorId } : d)))
      toast.success(nextCounsellorId ? 'Counsellor assigned' : 'Counsellor removed')
    } catch (error) {
      toast.error('Could not update assignment', error.message)
    } finally {
      setSavingId(null)
    }
  }

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

  if (canManageAssignments) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">Counsellor Assignments</h2>
          <Badge variant="saffron">Admin</Badge>
        </div>

        {devotees.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-10 text-slate-400">
                <Users className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No assignable members found in this VOICE.</p>
                <p className="text-xs text-slate-300 mt-1">Users with counsellor/admin roles are excluded from this list.</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {devotees.map((devotee) => (
              <Card key={devotee.id}>
                <CardBody className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{devotee.spiritual_name}</p>
                      {devotee.legal_name ? <p className="text-xs text-slate-400">{devotee.legal_name}</p> : null}
                    </div>

                    <select
                      value={draftAssignments[devotee.id] ?? ''}
                      onChange={(e) => setDraftAssignments((prev) => ({ ...prev, [devotee.id]: e.target.value }))}
                      className="w-full sm:w-64 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                      disabled={savingId === devotee.id || counsellors.length === 0}
                    >
                      <option value="">Unassigned</option>
                      {counsellors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.spiritual_name} ({ROLES[c.role] ?? c.role})
                        </option>
                      ))}
                    </select>

                    <Button
                      size="sm"
                      onClick={() => saveAssignment(devotee)}
                      loading={savingId === devotee.id}
                    >
                      Save
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
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
