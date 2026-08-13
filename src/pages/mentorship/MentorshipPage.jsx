import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { Users, LayoutDashboard, ShieldCheck, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import { useTerm } from '@/hooks/usePermission'
import Can from '@/components/Can'
import CounsellorDashboard from './CounsellorDashboard'
import CounselliProfile from './CounselliProfile'
import CounsellorManagement from './CounsellorManagement'

export default function MentorshipPage() {
  return (
    <Routes>
      <Route index element={<MentorshipHome />} />
      <Route path="dashboard" element={<CounsellorDashboard />} />
      <Route path="dashboard/counselli/:menteeId" element={<CounselliProfile />} />
      <Route path="manage" element={<CounsellorManagement />} />
    </Routes>
  )
}

function MentorshipHome() {
  const { profile, loginType } = useAuthStore()
  const { hasPermission } = useOrgStore()
  const mentorLabel  = useTerm('mentor', 'Mentor')
  const menteeLabel  = useTerm('mentee', 'Mentee')
  const pageLabel    = useTerm('mentorship', 'Mentorship')

  const [mentees,  setMentees]  = useState([])
  const [mentor,   setMentor]   = useState(null)
  const [loading,  setLoading]  = useState(true)

  const isMentorView = loginType === 'counsellor'

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      setLoading(true)
      if (isMentorView) {
        const { data: menteeRels } = await supabase.rpc('my_mentees')
        const ids = (menteeRels ?? []).map((r) => r.mentee_id)
        if (ids.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, spiritual_name, legal_name, avatar_url, role')
            .in('id', ids)
          setMentees(profiles ?? [])
        }
      } else {
        const { data } = await supabase.rpc('my_mentor')
        const rel = (data ?? [])[0] ?? null
        if (rel) {
          setMentor({
            id:             rel.mentor_id,
            spiritual_name: rel.mentor_name,
            avatar_url:     rel.mentor_avatar,
            phone:          rel.mentor_phone,
            type_name:      rel.type_name,
          })
        }
      }
      setLoading(false)
    }
    load()
  }, [profile, isMentorView])

  if (loading) return <div className="p-8 text-center text-slate-400">Loading {pageLabel}…</div>

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-extrabold text-slate-800">{pageLabel}</h1>

      <div className="flex flex-wrap gap-3">
        {hasPermission('mentorship.view_own') && (
          <Link to="dashboard" className="flex-1 min-w-[220px] flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-br from-saffron-500 to-orange-500 text-white shadow-sm hover:brightness-105 transition">
            <LayoutDashboard className="w-5 h-5" />
            <div className="flex-1">
              <p className="text-sm font-bold">Counsellor Dashboard</p>
              <p className="text-xs text-white/80">View your counsellis' reports</p>
            </div>
            <ChevronRight className="w-4 h-4" />
          </Link>
        )}
        <Can permission="mentorship.manage">
          <Link to="manage" className="flex-1 min-w-[220px] flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border border-slate-200 hover:border-saffron-300 transition">
            <ShieldCheck className="w-5 h-5 text-saffron-500" />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800">Counsellor Management</p>
              <p className="text-xs text-slate-400">Assign counsellors and counsellis</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </Link>
        </Can>
      </div>

      {isMentorView ? (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-600">Your {menteeLabel}s</h2>
          {mentees.length === 0 && (
            <Card>
              <CardBody className="py-10 text-center text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No {menteeLabel.toLowerCase()}s assigned yet.</p>
              </CardBody>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {mentees.map((m) => (
              <Card key={m.id}>
                <CardBody className="flex items-center gap-3">
                  <Avatar name={m.spiritual_name} url={m.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 truncate">{m.spiritual_name}</p>
                    <Badge variant="default" className="text-xs">{m.role}</Badge>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-600">Your {mentorLabel}</h2>
          {mentor ? (
            <Card>
              <CardBody className="flex items-center gap-4">
                <Avatar name={mentor.spiritual_name} url={mentor.avatar_url} size="md" />
                <div>
                  <p className="font-semibold text-slate-800">{mentor.spiritual_name}</p>
                  <Badge variant="saffron" className="text-xs">{mentorLabel}</Badge>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="py-10 text-center text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No {mentorLabel.toLowerCase()} assigned yet.</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

    </div>
  )
}
