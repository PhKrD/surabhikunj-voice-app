import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Users, Search, UserPlus, History, ShieldCheck, Loader2, ChevronRight, UserMinus,
} from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { Dialog } from '@/components/ui/Dialog'
import { AppInput } from '@/components/ui/Field'
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '@/components/ui/States'
import { useToast } from '@/store/toastStore'
import useOrgStore from '@/store/orgStore'
import {
  adminMentorshipOverview, mentorRelationships, adminMenteeSearch,
  assignMentee, endMentorship, menteeAssignmentHistory,
  ensureCounsellorRole, addMemberRole, getCounsellorType,
} from '@/lib/counsellorApi'
import { friendlyError } from '@/lib/friendlyError'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { confirm } from '@/store/dialogStore'

const SEARCH_DEBOUNCE_MS = 250

function fmtDate(value) {
  return value ? format(new Date(value), 'd MMM yyyy') : '—'
}

// ---------------------------------------------------------------------
// Member search picker — reused for both "Make Counsellor" and
// "Assign Counselli".
//
// The search depends ONLY on the query. Exclusions are applied at render
// time: the old version put an `excludeIds = []` default (a new array every
// render) into the search callback's deps, so the effect re-ran the search
// on every render, every search re-rendered, and the list flickered
// between "Searching…" and results forever.
// ---------------------------------------------------------------------
function MemberPicker({ open, title, description, excludeIds, statusFor, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pickingId, setPickingId] = useState(null)
  const [retryKey, setRetryKey] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    const seq = ++requestSeq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const rows = await adminMenteeSearch(query)
        // A slower, older request must not overwrite a newer one.
        if (seq !== requestSeq.current) return
        setResults(rows)
        setError(null)
      } catch (e) {
        if (seq === requestSeq.current) setError(e)
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    }, query ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [open, query, retryKey])

  // Reset when closed so the next open starts clean.
  useEffect(() => {
    if (open) return
    setQuery('')
    setResults(null)
    setError(null)
    setPickingId(null)
  }, [open])

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds])
  const visible = useMemo(() => (results ?? []).filter((r) => !excluded.has(r.id)), [results, excluded])

  const pick = async (member) => {
    if (pickingId) return
    setPickingId(member.id)
    try {
      await onPick(member)
    } finally {
      setPickingId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className="sm:max-w-lg h-[80svh] sm:h-[70vh]"
      bodyClassName="flex-1 pt-3"
    >
      <div className="sticky -top-3 z-10 -mx-5 px-5 -mt-3 pt-3 pb-3 bg-[var(--surface-elevated)]">
        <div className="relative">
          <AppInput
            autoFocus
            icon={Search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members"
            className="!pr-10"
          />
          {loading && results && (
            <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-token" aria-label="Searching" />
          )}
        </div>
      </div>

      {error && !results ? (
        <ErrorState compact error={error} onRetry={() => setRetryKey((k) => k + 1)} />
      ) : !results ? (
        <div className="space-y-2" role="status" aria-label="Loading members">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="w-1/2" />
                <Skeleton className="w-2/3 h-3" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title={query ? 'No one matches that' : 'No members to show'}
          description={query ? 'Try part of their name or email.' : 'Everyone is already assigned here.'}
        />
      ) : (
        <ul className={cn('-mx-2 space-y-0.5 transition-opacity', loading && 'opacity-60')}>
          {visible.map((r) => {
            const status = statusFor?.(r)
            const disabled = Boolean(status?.disabled)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={disabled || Boolean(pickingId)}
                  onClick={() => pick(r)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-[var(--radius-md)] text-left transition-colors hover:bg-[var(--surface-muted)] disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <Avatar name={r.display_name} url={r.avatar_url} size="md" />
                  <div className={cn('min-w-0 flex-1', disabled && 'opacity-60')}>
                    <p className="text-sm font-semibold text-primary-token truncate">{r.display_name}</p>
                    {r.email && <p className="text-xs text-muted-token truncate">{r.email}</p>}
                  </div>
                  {pickingId === r.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" aria-label="Saving" />
                    : status?.label && <Badge variant={status.variant ?? 'default'} className="text-[11px] max-w-[45%] truncate">{status.label}</Badge>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Assignment history for one counselli
// ---------------------------------------------------------------------
function HistoryDialog({ rel, onClose }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const menteeId = rel?.mentee_id

  useEffect(() => {
    if (!menteeId) return undefined
    let cancelled = false
    setHistory(null)
    setError(null)
    menteeAssignmentHistory(menteeId)
      .then((rows) => { if (!cancelled) setHistory(rows) })
      .catch((e) => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [menteeId])

  return (
    <Dialog open={Boolean(rel)} onClose={onClose} title="Assignment history" description={rel?.mentee_name}>
      {error ? (
        <ErrorState compact error={error} />
      ) : !history ? (
        <SkeletonList rows={2} />
      ) : history.length === 0 ? (
        <EmptyState compact icon={History} title="No history yet" />
      ) : (
        <ol className="relative border-l-2 border-[var(--border-color)] ml-2 space-y-4">
          {history.map((h) => (
            <li key={h.id} className="pl-4 relative">
              <span className={cn(
                'absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-4 ring-[var(--surface-elevated)]',
                h.ended_at ? 'bg-[var(--border-strong)]' : 'bg-[var(--color-primary)]',
              )} />
              <p className="text-sm font-semibold text-primary-token">{h.mentor_name}</p>
              <p className="text-xs text-muted-token">
                {fmtDate(h.started_at)} – {h.ended_at ? fmtDate(h.ended_at) : 'now'}
              </p>
              {h.assigned_by_name && <p className="text-[11px] text-muted-token mt-0.5">Assigned by {h.assigned_by_name}</p>}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Manage Counsellis — for one counsellor
// ---------------------------------------------------------------------
function ManageCounsellisDialog({ counsellor, typeId, onClose, onChanged }) {
  const toast = useToast()
  const [rels, setRels] = useState(null)
  const [error, setError] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const mentorId = counsellor?.mentor_id

  const load = useCallback(async () => {
    if (!mentorId) return
    try {
      setRels(await mentorRelationships(mentorId, typeId))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [mentorId, typeId])

  useEffect(() => {
    setRels(null)
    load()
  }, [load])

  const active = useMemo(() => (rels ?? []).filter((r) => r.status === 'active'), [rels])
  const past = useMemo(() => (rels ?? []).filter((r) => r.status !== 'active'), [rels])
  const excludeIds = useMemo(() => [mentorId, ...active.map((r) => r.mentee_id)], [mentorId, active])

  const handleAssign = async (member) => {
    if (member.current_mentor_id && member.current_mentor_id !== mentorId) {
      const ok = await confirm({
        title: `Move ${member.display_name}?`,
        message: `${member.display_name} is with ${member.current_mentor_name ?? 'another counsellor'} now. Move them to ${counsellor.mentor_name}?`,
        confirmLabel: 'Move',
      })
      if (!ok) return
    }
    try {
      await assignMentee({ menteeId: member.id, mentorId, typeId })
      toast.success('Assigned', `${member.display_name} is now with ${counsellor.mentor_name}`)
      setShowPicker(false)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Could not assign', friendlyError(e))
    }
  }

  const handleEnd = async (rel) => {
    const ok = await confirm({
      title: `Remove ${rel.mentee_name}?`,
      message: `${rel.mentee_name} will no longer be assigned to ${counsellor.mentor_name}. Their history is kept.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusyId(rel.id)
    try {
      await endMentorship(rel.id)
      toast.success('Removed', `${rel.mentee_name} unassigned`)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Could not remove', friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Dialog
        open={Boolean(counsellor)}
        onClose={onClose}
        className="sm:max-w-lg"
        title={counsellor && (
          <span className="flex items-center gap-3">
            <Avatar name={counsellor.mentor_name} url={counsellor.mentor_avatar} size="md" />
            <span className="min-w-0">
              <span className="block truncate">{counsellor.mentor_name}</span>
              <span className="block text-caption font-normal tracking-normal">
                {rels ? `${active.length} counselli${active.length === 1 ? '' : 's'}` : 'Loading…'}
              </span>
            </span>
          </span>
        )}
      >
        <Button icon={UserPlus} onClick={() => setShowPicker(true)} className="w-full mb-4">
          Assign a counselli
        </Button>

        {error && !rels ? (
          <ErrorState compact error={error} onRetry={load} />
        ) : !rels ? (
          <SkeletonList rows={3} />
        ) : (
          <div className="space-y-5">
            <section>
              <p className="text-overline mb-2">Current · {active.length}</p>
              {active.length === 0 ? (
                <p className="text-caption py-3">No counsellis yet. Tap “Assign a counselli” to add one.</p>
              ) : (
                <ul className="space-y-1.5">
                  {active.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 p-2.5 rounded-[var(--radius-md)] bg-[var(--surface-muted)]">
                      <Avatar name={r.mentee_name} url={r.mentee_avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-primary-token truncate">{r.mentee_name}</p>
                        <p className="text-[11px] text-muted-token">Since {fmtDate(r.started_at)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHistoryFor(r)}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-muted-token hover:bg-[var(--surface-sunken)]"
                        aria-label={`History for ${r.mentee_name}`}
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEnd(r)}
                        disabled={busyId === r.id}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
                        aria-label={`Remove ${r.mentee_name}`}
                      >
                        {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {past.length > 0 && (
              <section>
                <p className="text-overline mb-2">Past · {past.length}</p>
                <ul className="space-y-1">
                  {past.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-2.5 py-2 rounded-[var(--radius-md)]">
                      <Avatar name={r.mentee_name} url={r.mentee_avatar} size="sm" className="opacity-60" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-secondary-token truncate">{r.mentee_name}</p>
                        <p className="text-[11px] text-muted-token">{fmtDate(r.started_at)} – {fmtDate(r.ended_at)}</p>
                      </div>
                      <Badge className="text-[10px]">ended</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Dialog>

      <MemberPicker
        open={Boolean(counsellor) && showPicker}
        title="Assign a counselli"
        description={counsellor ? `To ${counsellor.mentor_name}` : undefined}
        excludeIds={excludeIds}
        statusFor={(r) => (r.current_mentor_id
          ? { label: `with ${r.current_mentor_name ?? 'someone'}`, variant: 'warning' }
          : null)}
        onPick={handleAssign}
        onClose={() => setShowPicker(false)}
      />

      <HistoryDialog rel={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  )
}

// ---------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------
export default function CounsellorManagement() {
  const toast = useToast()
  // Selecting the boolean (not the function) re-renders when permissions load.
  const canManage = useOrgStore((s) => s.permissions.includes('*') || s.permissions.includes('mentorship.manage'))
  const [counsellors, setCounsellors] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showMakePicker, setShowMakePicker] = useState(false)
  const [manageTarget, setManageTarget] = useState(null)
  const [typeId, setTypeId] = useState(null)

  const load = useCallback(async () => {
    try {
      const type = await getCounsellorType()
      setTypeId(type?.id ?? null)
      setCounsellors(await adminMentorshipOverview(type?.id ?? null))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => { if (canManage) load() }, [canManage, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!counsellors || !q) return counsellors ?? []
    return counsellors.filter((c) => c.mentor_name?.toLowerCase().includes(q))
  }, [counsellors, search])

  const counsellorIds = useMemo(() => new Set((counsellors ?? []).map((c) => c.mentor_id)), [counsellors])

  const handleMakeCounsellor = async (member) => {
    try {
      const roleId = await ensureCounsellorRole()
      await addMemberRole(member.id, roleId)
      toast.success('Counsellor added', `${member.display_name} can now open the Counsellor Dashboard`)
      setShowMakePicker(false)
      await load()
    } catch (e) {
      toast.error('Could not make counsellor', friendlyError(e))
    }
  }

  if (!canManage) {
    return (
      <EmptyState icon={ShieldCheck} title="Admins only" description="Ask an admin if you need to manage counsellors." />
    )
  }

  const totalCounsellis = (counsellors ?? []).reduce((n, c) => n + (c.active_mentees ?? 0), 0)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title text-primary-token">Counsellors</h1>
          <p className="text-caption mt-0.5">
            {counsellors
              ? `${counsellors.length} counsellor${counsellors.length === 1 ? '' : 's'} · ${totalCounsellis} counselli${totalCounsellis === 1 ? '' : 's'}`
              : 'Assign counsellors and manage their counsellis.'}
          </p>
        </div>
        <Button icon={UserPlus} onClick={() => setShowMakePicker(true)} className="flex-shrink-0">
          <span className="hidden sm:inline">Make counsellor</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>

      {(counsellors?.length ?? 0) > 4 && (
        <AppInput
          icon={Search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search counsellors"
          aria-label="Search counsellors"
        />
      )}

      {error && !counsellors ? (
        <ErrorState error={error} onRetry={load} />
      ) : !counsellors ? (
        <SkeletonList rows={3} />
      ) : filtered.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={Users}
            title={search ? 'No counsellor by that name' : 'No counsellors yet'}
            description={search ? undefined : 'Make a member a counsellor, then assign counsellis to them.'}
            action={!search && <Button icon={UserPlus} onClick={() => setShowMakePicker(true)}>Make counsellor</Button>}
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.mentor_id}>
              <Card hover as="button" type="button" onClick={() => setManageTarget(c)} className="w-full text-left flex items-center gap-3 p-4">
                <Avatar name={c.mentor_name} url={c.mentor_avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-primary-token truncate">{c.mentor_name}</p>
                  <p className="text-xs text-muted-token">
                    {c.assigned_since ? `Since ${fmtDate(c.assigned_since)}` : 'No counsellis yet'}
                  </p>
                </div>
                <Badge variant={c.active_mentees ? 'primary' : 'default'}>
                  {c.active_mentees ?? 0} counselli{c.active_mentees === 1 ? '' : 's'}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-token flex-shrink-0" aria-hidden="true" />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <MemberPicker
        open={showMakePicker}
        title="Make a counsellor"
        description="Pick a member. They keep their other roles."
        statusFor={(r) => (counsellorIds.has(r.id) ? { label: 'already a counsellor', disabled: true } : null)}
        onPick={handleMakeCounsellor}
        onClose={() => setShowMakePicker(false)}
      />

      <ManageCounsellisDialog
        counsellor={manageTarget}
        typeId={typeId}
        onClose={() => setManageTarget(null)}
        onChanged={load}
      />
    </div>
  )
}
