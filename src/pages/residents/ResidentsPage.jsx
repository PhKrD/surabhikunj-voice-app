import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Users, Search, MapPin, ChevronRight, BadgeCheck, Building2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { ROLES, ROLE_COLORS } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
]

export default function ResidentsPage() {
  const { profile } = useAuthStore()
  const { org } = useOrgStore()
  const orgId = org?.id ?? profile?.org_id
  const navigate = useNavigate()
  const [residents, setResidents] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptByProfile, setDeptByProfile] = useState({})
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [deptFilter, setDeptFilter] = useState('all')
  const [initiatedOnly, setInitiatedOnly] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const [profilesRes, deptRes, memberRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, spiritual_name, legal_name, role, avatar_url, room_number, phone, initiated, is_active')
        .eq('org_id', orgId)
        .order('spiritual_name', { ascending: true }),
      supabase
        .from('departments')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('department_members')
        .select('profile_id, department:department_id(id, name)'),
    ])
    setResidents(profilesRes.data ?? [])
    setDepartments(deptRes.data ?? [])
    const map = {}
    for (const m of memberRes.data ?? []) {
      if (!m.department) continue
      if (!map[m.profile_id]) map[m.profile_id] = []
      map[m.profile_id].push(m.department.name)
    }
    setDeptByProfile(map)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    const id = setTimeout(() => { load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return residents.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      if (roleFilter !== 'all' && r.role !== roleFilter) return false
      if (deptFilter !== 'all' && !(deptByProfile[r.id] ?? []).includes(deptFilter)) return false
      if (initiatedOnly && !r.initiated) return false
      if (q) {
        const hay = `${r.spiritual_name ?? ''} ${r.legal_name ?? ''} ${r.room_number ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [residents, search, statusFilter, roleFilter, deptFilter, initiatedOnly, deptByProfile])

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-saffron-500" />
        <h2 className="text-lg font-bold text-primary-token">Residents</h2>
        <Badge variant="default" className="ml-1">{filtered.length}</Badge>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="py-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-token" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or room..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border-color)] text-sm text-primary-token placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-saffron-300 focus:border-transparent transition"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--border-color)] text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-saffron-300"
            >
              <option value="all">All roles</option>
              {Object.entries(ROLES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--border-color)] text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-saffron-300"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {departments.length > 0 && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[var(--border-color)] text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-saffron-300"
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setInitiatedOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition ${
                initiatedOnly
                  ? 'bg-saffron-50 border-saffron-200 text-saffron-700'
                  : 'bg-[var(--surface)] border-[var(--border-color)] text-secondary-token hover:bg-[var(--surface-muted)]'
              }`}
            >
              <BadgeCheck className="w-4 h-4" />
              Initiated
            </button>
          </div>
        </CardBody>
      </Card>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-muted-token text-sm">Loading residents...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-muted-token">
              <Users className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No residents match your filters.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r, idx) => (
            <motion.button
              key={r.id}
              type="button"
              onClick={() => navigate(`/residents/${r.id}`)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.3) }}
              className="text-left"
            >
              <Card className={`h-full transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 ${r.is_active ? '' : 'opacity-60'}`}>
                <CardBody className="py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.spiritual_name} url={r.avatar_url} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-primary-token truncate">{r.spiritual_name}</p>
                      {r.legal_name && <p className="text-xs text-muted-token truncate">{r.legal_name}</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-token flex-shrink-0" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <Badge className={ROLE_COLORS[r.role]}>{ROLES[r.role] ?? r.role}</Badge>
                    {r.initiated && <Badge variant="saffron">Initiated</Badge>}
                    {!r.is_active && <Badge variant="red">Inactive</Badge>}
                    {(deptByProfile[r.id] ?? []).map((d) => (
                      <span key={d} className="flex items-center gap-1 text-xs text-muted-token">
                        <Building2 className="w-3 h-3" />
                        {d}
                      </span>
                    ))}
                    {r.room_number && (
                      <span className="flex items-center gap-1 text-xs text-muted-token">
                        <MapPin className="w-3 h-3" />
                        Room {r.room_number}
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  )
}
