import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users, Search, UserPlus, X, ArrowRightLeft, History, ShieldCheck, Loader2,
} from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import useToastStore from '@/store/toastStore'
import useOrgStore from '@/store/orgStore'
import {
  adminMentorshipOverview, mentorRelationships, adminMenteeSearch,
  assignMentee, endMentorship, menteeAssignmentHistory,
  ensureCounsellorRole, addMemberRole,
} from '@/lib/counsellorApi'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'

// ---------------------------------------------------------------------
// Member search picker — reused for both "Make Counsellor" and
// "Assign Counselli".
// ---------------------------------------------------------------------
function MemberPicker({ title, excludeIds = [], onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (q) => {
    setLoading(true)
    try {
      const rows = await adminMenteeSearch(q)
      setResults(rows.filter((r) => !excludeIds.includes(r.id)))
    } finally {
      setLoading(false)
    }
  }, [excludeIds])

  useEffect(() => { search('') }, [search])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); search(e.target.value) }}
              placeholder="Search by name, phone or email…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <div className="p-6 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">No members found.</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-saffron-50 text-left transition"
            >
              <Avatar name={r.display_name} url={r.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{r.display_name}</p>
                {r.email && <p className="text-xs text-slate-400 truncate">{r.email}</p>}
              </div>
              {r.current_mentor_id && (
                <Badge variant="default" className="text-[10px] whitespace-nowrap">has counsellor</Badge>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Manage Counsellis modal — for one counsellor
// ---------------------------------------------------------------------
function ManageCounsellisModal({ counsellor, typeId, onClose, onChanged }) {
  const toast = useToastStore()
  const [rels, setRels] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)
  const [history, setHistory] = useState([])
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await mentorRelationships(counsellor.mentor_id, typeId)
      setRels(rows)
    } catch (e) {
      toast.error('Could not load counsellis', e.message)
    } finally {
      setLoading(false)
    }
  }, [counsellor.mentor_id, typeId, toast])

  useEffect(() => { load() }, [load])

  const active = rels.filter((r) => r.status === 'active')
  const past = rels.filter((r) => r.status !== 'active')

  const handleAssign = async (member) => {
    setShowPicker(false)
    if (member.current_mentor_id && member.current_mentor_id !== counsellor.mentor_id) {
      const ok = window.confirm(`${member.display_name} is currently assigned to ${member.current_mentor_name}. Transfer to ${counsellor.mentor_name}?`)
      if (!ok) return
    }
    try {
      await assignMentee({ menteeId: member.id, mentorId: counsellor.mentor_id, typeId })
      toast.success('Assigned', `${member.display_name} is now a counselli of ${counsellor.mentor_name}`)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Could not assign', e.message)
    }
  }

  const handleEnd = async (rel) => {
    if (!window.confirm(`Remove ${rel.mentee_name} from ${counsellor.mentor_name}'s counsellis?`)) return
    setBusyId(rel.id)
    try {
      await endMentorship(rel.id)
      toast.success('Removed', `${rel.mentee_name} unassigned`)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Could not remove', e.message)
    } finally {
      setBusyId(null)
    }
  }

  const openHistory = async (rel) => {
    setHistoryFor(rel)
    const rows = await menteeAssignmentHistory(rel.mentee_id)
    setHistory(rows)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <Avatar name={counsellor.mentor_name} url={counsellor.mentor_avatar} size="sm" />
            <div>
              <h3 className="font-bold text-slate-800">{counsellor.mentor_name}</h3>
              <p className="text-xs text-slate-400">{active.length} active counselli{active.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 border-b border-slate-100">
          <Button size="sm" icon={UserPlus} onClick={() => setShowPicker(true)}>Assign Counselli</Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-center text-sm text-slate-400 py-8">Loading…</div>
          ) : (
            <>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Current ({active.length})</p>
                {active.length === 0 && <p className="text-sm text-slate-400">No counsellis assigned yet.</p>}
                <div className="space-y-1.5">
                  {active.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50">
                      <Avatar name={r.mentee_name} url={r.mentee_avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{r.mentee_name}</p>
                        <p className="text-[11px] text-slate-400">Since {format(new Date(r.started_at), 'd MMM yyyy')}</p>
                      </div>
                      <button onClick={() => openHistory(r)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200" title="History">
                        <History className="w-3.5 h-3.5" />
                      </button>
                      <Button size="xs" variant="danger" loading={busyId === r.id} onClick={() => handleEnd(r)}>Remove</Button>
                    </div>
                  ))}
                </div>
              </div>

              {past.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Past ({past.length})</p>
                  <div className="space-y-1.5">
                    {past.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-xl opacity-60">
                        <Avatar name={r.mentee_name} url={r.mentee_avatar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-600 truncate">{r.mentee_name}</p>
                          <p className="text-[11px] text-slate-400">
                            {format(new Date(r.started_at), 'd MMM yyyy')} – {r.ended_at ? format(new Date(r.ended_at), 'd MMM yyyy') : '—'}
                          </p>
                        </div>
                        <Badge variant="default" className="text-[10px]">ended</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showPicker && (
        <MemberPicker
          title={`Assign a counselli to ${counsellor.mentor_name}`}
          excludeIds={active.map((r) => r.mentee_id)}
          onPick={handleAssign}
          onClose={() => setShowPicker(false)}
        />
      )}

      {historyFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setHistoryFor(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm max-h-[70vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800">Assignment History — {historyFor.mentee_name}</h3>
              <button onClick={() => setHistoryFor(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {history.map((h) => (
                <div key={h.id} className="px-3 py-2 rounded-xl bg-slate-50 text-sm">
                  <p className="font-semibold text-slate-700">{h.mentor_name}</p>
                  <p className="text-xs text-slate-400">
                    {format(new Date(h.started_at), 'd MMM yyyy')} – {h.ended_at ? format(new Date(h.ended_at), 'd MMM yyyy') : 'current'}
                  </p>
                  {h.assigned_by_name && <p className="text-[11px] text-slate-400">Assigned by {h.assigned_by_name}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------
export default function CounsellorManagement() {
  const toast = useToastStore()
  const { hasPermission } = useOrgStore()
  const [counsellors, setCounsellors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showMakePicker, setShowMakePicker] = useState(false)
  const [manageTarget, setManageTarget] = useState(null)
  const [typeId, setTypeId] = useState(null)
  const [makingId, setMakingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: type } = await supabase.from('mentorship_types').select('id').eq('name', 'Counsellor').maybeSingle()
      setTypeId(type?.id ?? null)
      const rows = await adminMentorshipOverview(type?.id ?? null)
      setCounsellors(rows)
    } catch (e) {
      toast.error('Could not load counsellors', e.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return counsellors
    return counsellors.filter((c) => c.mentor_name?.toLowerCase().includes(q))
  }, [counsellors, search])

  const handleMakeCounsellor = async (member) => {
    setShowMakePicker(false)
    setMakingId(member.id)
    try {
      const roleId = await ensureCounsellorRole()
      await addMemberRole(member.id, roleId)
      toast.success('Counsellor created', `${member.display_name} can now access the Counsellor Dashboard`)
      await load()
    } catch (e) {
      toast.error('Could not make counsellor', e.message)
    } finally {
      setMakingId(null)
    }
  }

  if (!hasPermission('mentorship.manage')) {
    return <div className="text-center py-12 text-slate-400 text-sm">Admins only.</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-saffron-500" /> Counsellor Management
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Assign counsellors and manage their counsellis.</p>
        </div>
        <Button size="sm" icon={UserPlus} onClick={() => setShowMakePicker(true)}>Make Counsellor</Button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search counsellors…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300 bg-white"
        />
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-12">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardBody className="py-10 text-center text-slate-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No counsellors yet. Click "Make Counsellor" to assign one.</p>
        </CardBody></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.mentor_id}>
              <CardBody className="flex items-center gap-3">
                <Avatar name={c.mentor_name} url={c.mentor_avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 truncate">{c.mentor_name}</p>
                  <p className="text-xs text-slate-400">
                    {c.active_mentees} counselli{c.active_mentees === 1 ? '' : 's'}
                    {c.assigned_since && <> · since {format(new Date(c.assigned_since), 'd MMM yyyy')}</>}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon={ArrowRightLeft} onClick={() => setManageTarget(c)}>
                  Manage Counsellis
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showMakePicker && (
        <MemberPicker
          title="Make a member a Counsellor"
          onPick={handleMakeCounsellor}
          onClose={() => setShowMakePicker(false)}
        />
      )}

      {manageTarget && (
        <ManageCounsellisModal
          counsellor={manageTarget}
          typeId={typeId}
          onClose={() => setManageTarget(null)}
          onChanged={load}
        />
      )}

      {makingId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/20">
          <div className="bg-white rounded-2xl px-6 py-4 shadow-xl text-sm text-slate-600 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Setting up counsellor access…
          </div>
        </div>
      )}
    </div>
  )
}
