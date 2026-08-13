import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Mail, ShieldCheck, Clock, UserCog, Check, X, Save, UserPlus, Phone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import useOrgStore from '@/store/orgStore'
import { cn } from '@/lib/utils'

const SELECT_COLS = 'id, spiritual_name, legal_name, email, avatar_url, role, is_approved'

export default function MembersPage() {
  const { profile } = useAuthStore()
  const { org, hasPermission } = useOrgStore()
  const toast = useToastStore()
  const orgId = org?.id ?? profile?.org_id
  const isAdmin = hasPermission('members.manage')

  const [orgRoles, setOrgRoles] = useState([]) // [{ id, name }]
  const [members, setMembers] = useState([])
  const [drafts, setDrafts] = useState({}) // { [id]: { role, is_approved } }
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [search, setSearch] = useState('')
  const [emailQuery, setEmailQuery] = useState('')
  const [highlightId, setHighlightId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newMember, setNewMember] = useState({ legal_name: '', email: '', phone: '', role_id: '' })

  const seedDrafts = useCallback((rows) => {
    setDrafts(Object.fromEntries(rows.map((r) => [r.id, { role_id: r.role_id, is_approved: r.is_approved }])))
  }, [])

  useEffect(() => {
    if (!org?.id) return
    supabase.from('roles').select('id, name').eq('org_id', org.id).order('name')
      .then(({ data }) => { if (data?.length) { setOrgRoles(data); setNewMember((n) => ({ ...n, role_id: data[0].id })) } })
  }, [org?.id])

  const load = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      // org_members() reads from `memberships`, so pending join requests are
      // included — filtering profiles by org_id would hide them entirely.
      const { data, error } = await supabase.rpc('org_members')
      if (error) throw error
      const rows = (data ?? []).map((r) => ({
        ...r,
        spiritual_name: r.spiritual_name ?? r.display_name,
        is_approved:    r.status === 'active',
      }))
      setMembers(rows)
      seedDrafts(rows)
    } catch (err) {
      toast.error('Could not load members', err.message)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, seedDrafts, toast])

  useEffect(() => { load() }, [load])

  const pendingCount = useMemo(() => members.filter((m) => !m.is_approved).length, [members])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.spiritual_name?.toLowerCase().includes(q) ||
        m.legal_name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
    )
  }, [members, search])

  const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  const isDirty = (m) => {
    const d = drafts[m.id]
    return d && (d.role_id !== m.role_id || d.is_approved !== m.is_approved)
  }

  const handleFindByEmail = async (e) => {
    e.preventDefault()
    const q = emailQuery.trim().toLowerCase()
    if (!q) return
    // Already loaded?
    const local = members.find((m) => m.email?.toLowerCase() === q)
    if (local) {
      setSearch(emailQuery.trim())
      setHighlightId(local.id)
      setTimeout(() => setHighlightId(null), 2500)
      return
    }
    // Query within voice
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(SELECT_COLS)
        .eq('org_id', orgId)
        .ilike('email', q)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        toast.error('No devotee found', 'They must sign up and open the app once first.')
        return
      }
      setMembers((prev) => [data, ...prev])
      // This profile wasn't in org_members() (no membership row yet), so we
      // have no role_id for it — leave the draft unset until an admin picks one.
      setDrafts((d) => ({ ...d, [data.id]: { role_id: null, is_approved: data.is_approved } }))
      setSearch(emailQuery.trim())
      setHighlightId(data.id)
      setTimeout(() => setHighlightId(null), 2500)
    } catch (err) {
      toast.error('Lookup failed', err.message)
    }
  }

  const saveMember = async (m) => {
    const d = drafts[m.id]
    if (!d) return
    setSavingId(m.id)
    try {
      // Approval lives on the membership, not the profile, so it must go
      // through the RPC — updating profiles.is_approved alone would leave the
      // membership 'pending' and the member still locked out.
      if (d.is_approved !== m.is_approved) {
        const { error } = await supabase.rpc('approve_membership', {
          p_user_id: m.id,
          p_approve: d.is_approved,
        })
        if (error) throw error
      }

      if (d.role_id && d.role_id !== m.role_id) {
        // Writes membership_roles (what has_permission() actually reads),
        // not profiles.role — the legacy column has no effect on access.
        const { error } = await supabase.rpc('set_member_role', {
          p_user_id: m.id,
          p_role_id: d.role_id,
        })
        if (error) throw error
      }

      toast.success('Member updated', `${m.spiritual_name} saved`)
      await load()
    } catch (err) {
      toast.error('Could not save', err.message)
    } finally {
      setSavingId(null)
    }
  }

  const setNew = (patch) => setNewMember((n) => ({ ...n, ...patch }))

  const handleCreateMember = async (e) => {
    e.preventDefault()
    const email = newMember.email.trim().toLowerCase()
    const phone = newMember.phone.replace(/\D/g, '')
    if (!email) return toast.error('Email required', 'Enter the devotee\'s email address.')
    if (phone && phone.length < 6) return toast.error('Invalid mobile', 'Mobile becomes their first password, so it must be at least 6 digits.')
    setCreating(true)
    try {
      const roleName = orgRoles.find((r) => r.id === newMember.role_id)?.name
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email,
          legal_name: newMember.legal_name.trim(),
          spiritual_name: newMember.legal_name.trim(),
          phone,
          role: roleName,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success('Member created', `${newMember.legal_name || email} added${phone ? ` (password: ${phone})` : ''}`)
      const row = {
        id: data.id,
        spiritual_name: newMember.legal_name.trim() || email,
        legal_name: newMember.legal_name.trim(),
        email,
        avatar_url: null,
        role_id: newMember.role_id,
        role_name: roleName,
        is_approved: true,
        status: 'active',
      }
      setMembers((prev) => [row, ...prev.filter((m) => m.id !== row.id)])
      setDrafts((d) => ({ ...d, [row.id]: { role_id: row.role_id, is_approved: row.is_approved } }))
      setNewMember({ legal_name: '', email: '', phone: '', role_id: orgRoles[0]?.id ?? '' })
      setShowAdd(false)
      setHighlightId(row.id)
      setTimeout(() => setHighlightId(null), 2500)
    } catch (err) {
      toast.error('Could not create member', err.message)
    } finally {
      setCreating(false)
    }
  }

  if (!isAdmin) {
    return <div className="text-center py-12 text-slate-400 text-sm">Admins only.</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
            <UserCog className="w-5 h-5 text-saffron-500" /> Assign Members
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Approve devotees and assign their role.</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Badge variant="yellow" className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {pendingCount} pending
            </Badge>
          )}
          <Button size="sm" icon={UserPlus} onClick={() => setShowAdd((v) => !v)}>Add member</Button>
        </div>
      </div>

      {/* Add member form */}
      {showAdd && (
        <Card>
          <CardBody className="py-4">
            <form onSubmit={handleCreateMember} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <UserPlus className="w-4 h-4 text-saffron-500" /> Create a new profile
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Full name"
                  value={newMember.legal_name}
                  onChange={(e) => setNew({ legal_name: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300"
                />
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={newMember.email}
                    onChange={(e) => setNew({ email: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300"
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    placeholder="Mobile (becomes first password)"
                    value={newMember.phone}
                    onChange={(e) => setNew({ phone: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300"
                  />
                </div>
                <select
                  value={newMember.role_id}
                  onChange={(e) => setNew({ role_id: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-saffron-300"
                >
                  {orgRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" icon={UserPlus} loading={creating}>Create profile</Button>
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-slate-500 px-3 py-2">Cancel</button>
              </div>
              <p className="text-[11px] text-slate-400">The devotee signs in with their email and mobile number as the initial password, then changes it in Settings.</p>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Assign by email */}
      <Card>
        <CardBody className="py-4">
          <form onSubmit={handleFindByEmail} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-saffron-500 transition-colors" />
              <input
                type="email"
                placeholder="Find devotee by email address…"
                value={emailQuery}
                onChange={(e) => setEmailQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 focus:bg-white transition-all"
              />
            </div>
            <Button type="submit" icon={Search} className="sm:w-auto w-full">Find</Button>
          </form>
        </CardBody>
      </Card>

      {/* Search box */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search all members by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-400/60 focus:border-saffron-300 transition-all"
        />
      </div>

      {/* Members list */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading members…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <UserCog className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No members found.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => {
            const d = drafts[m.id] ?? { role_id: m.role_id, is_approved: m.is_approved }
            const dirty = isDirty(m)
            const self = m.id === profile.id
            return (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Card className={cn(highlightId === m.id && 'ring-2 ring-saffron-400')}>
                  <CardBody className="py-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={m.spiritual_name} url={m.avatar_url} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800 truncate">{m.spiritual_name}</p>
                          {m.is_approved ? (
                            <Badge variant="tulasi" className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Approved</Badge>
                          ) : (
                            <Badge variant="yellow" className="flex items-center gap-1"><Clock className="w-3 h-3" /> Pending</Badge>
                          )}
                          {self && <Badge variant="blue">You</Badge>}
                        </div>
                        {m.email && <p className="text-xs text-slate-400 mt-0.5 truncate">{m.email}</p>}

                        {/* Controls */}
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <select
                            value={d.role_id ?? ''}
                            onChange={(e) => setDraft(m.id, { role_id: e.target.value })}
                            disabled={self}
                            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-saffron-300 disabled:opacity-60"
                          >
                            {!d.role_id && <option value="">Select a role…</option>}
                            {orgRoles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => setDraft(m.id, { is_approved: !d.is_approved })}
                            disabled={self}
                            className={cn(
                              'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-60',
                              d.is_approved
                                ? 'grad-tulasi text-white shadow-[0_6px_16px_-6px_rgba(34,197,94,0.5)]'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            )}
                          >
                            {d.is_approved ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                            {d.is_approved ? 'Approved' : 'Not approved'}
                          </button>

                          <Button
                            size="sm"
                            icon={Save}
                            loading={savingId === m.id}
                            disabled={!dirty || self}
                            onClick={() => saveMember(m)}
                            className={cn(!dirty && 'opacity-50')}
                          >
                            Save
                          </Button>
                        </div>
                        {self && <p className="text-[11px] text-slate-400 mt-2">You can't change your own role or approval.</p>}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
