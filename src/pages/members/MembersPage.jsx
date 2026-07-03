import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Mail, ShieldCheck, Clock, UserCog, Check, X, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { ROLES, ADMIN_ROLES, cn } from '@/lib/utils'

const SELECT_COLS = 'id, spiritual_name, legal_name, email, avatar_url, role, is_approved, counsellor_id'

export default function MembersPage() {
  const { profile } = useAuthStore()
  const toast = useToastStore()
  const isAdmin = ADMIN_ROLES.includes(profile?.role)

  const [members, setMembers] = useState([])
  const [drafts, setDrafts] = useState({}) // { [id]: { role, is_approved } }
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [search, setSearch] = useState('')
  const [emailQuery, setEmailQuery] = useState('')
  const [highlightId, setHighlightId] = useState(null)

  const seedDrafts = useCallback((rows) => {
    setDrafts(Object.fromEntries(rows.map((r) => [r.id, { role: r.role, is_approved: r.is_approved }])))
  }, [])

  useEffect(() => {
    if (!profile?.voice_id || !isAdmin) return
    const load = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(SELECT_COLS)
          .eq('voice_id', profile.voice_id)
          .order('is_approved', { ascending: true })
          .order('spiritual_name', { ascending: true })
        if (error) throw error
        const rows = data ?? []
        setMembers(rows)
        seedDrafts(rows)
      } catch (err) {
        toast.error('Could not load members', err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile?.voice_id, isAdmin, seedDrafts, toast])

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
    return d && (d.role !== m.role || d.is_approved !== m.is_approved)
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
        .eq('voice_id', profile.voice_id)
        .ilike('email', q)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        toast.error('No devotee found', 'They must sign up and open the app once first.')
        return
      }
      setMembers((prev) => [data, ...prev])
      setDrafts((d) => ({ ...d, [data.id]: { role: data.role, is_approved: data.is_approved } }))
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
      const { error } = await supabase
        .from('profiles')
        .update({ role: d.role, is_approved: d.is_approved })
        .eq('id', m.id)
        .eq('voice_id', profile.voice_id)
      if (error) throw error
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role: d.role, is_approved: d.is_approved } : x)))
      toast.success('Member updated', `${m.spiritual_name} saved`)
    } catch (err) {
      toast.error('Could not save', err.message)
    } finally {
      setSavingId(null)
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
        {pendingCount > 0 && (
          <Badge variant="yellow" className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {pendingCount} pending
          </Badge>
        )}
      </div>

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
            const d = drafts[m.id] ?? { role: m.role, is_approved: m.is_approved }
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
                            value={d.role}
                            onChange={(e) => setDraft(m.id, { role: e.target.value })}
                            disabled={self}
                            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-saffron-300 disabled:opacity-60"
                          >
                            {Object.entries(ROLES).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
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
