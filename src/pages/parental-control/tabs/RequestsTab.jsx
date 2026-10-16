import { useState, useEffect, useCallback } from 'react'
import { Check, X, Clock, Smartphone, Globe, Send, Info, Inbox } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { EmptyState, SkeletonList } from '@/components/ui/States'
import { useToast } from '@/store/toastStore'
import { friendlyError } from '@/lib/friendlyError'
import { listChildRequests, resolveChildRequest } from '@/lib/parentalControlApi'

const TYPES = {
  bonus_time: { icon: Clock, label: 'More time' },
  app_unblock: { icon: Smartphone, label: 'App' },
  website_access: { icon: Globe, label: 'Website' },
  schedule_exception: { icon: Clock, label: 'Routine break' },
}

const STATUS_BADGE = { approved: ['success', 'Approved'], denied: ['danger', 'Declined'], pending: ['warning', 'Waiting'] }

/**
 * What approving will actually do. Requests from the phone's block screen
 * and the child's app/website picker carry the exact package / domain, so
 * resolveChildRequest() applies them itself; a free-typed app name can't be
 * applied safely, and we say so instead of pretending.
 */
function describe(req) {
  const m = req.metadata ?? {}
  switch (req.request_type) {
    case 'bonus_time':
      return { title: `${m.minutes ?? 30} more minutes`, effect: `Approve gives ${m.minutes ?? 30} minutes of extra time now.`, auto: true }
    case 'app_unblock':
      return m.package_name
        ? { title: m.app_name ?? m.package_name, effect: `Approve allows ${m.app_name ?? 'this app'} on the phone.`, auto: true }
        : { title: m.app_name ?? 'An app', effect: 'Approving only answers your child. Change the app’s rule yourself in Apps.', auto: false }
    case 'website_access':
      return m.domain
        ? { title: m.domain, effect: `Approve allows ${m.domain} on the phone.`, auto: true }
        : { title: 'A website', effect: 'Approving only answers your child. Add the site yourself in Web → Filtering.', auto: false }
    default:
      return { title: TYPES[req.request_type]?.label ?? 'Request', effect: 'Approving only answers your child.', auto: false }
  }
}

export default function RequestsTab({ childId, onChildUpdated }) {
  const toast = useToast()
  const [requests, setRequests] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try {
      setRequests(await listChildRequests(childId))
    } catch (error) {
      toast.error('Could not load requests', friendlyError(error))
      setRequests((r) => r ?? [])
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const handleResolve = async (request, approve) => {
    setBusy(`${request.id}:${approve}`)
    try {
      await resolveChildRequest(request.id, { approve, bonusMinutes: request.metadata?.minutes || 30 })
      toast.success(approve ? 'Approved' : 'Declined', approve && describe(request).auto ? 'Applied to the phone.' : undefined)
      await load()
      onChildUpdated?.()
    } catch (error) {
      toast.error('Could not answer this request', friendlyError(error))
    } finally {
      setBusy(null)
    }
  }

  if (!requests) return <SkeletonList rows={3} />

  const pending = requests.filter((r) => r.status === 'pending')
  const answered = requests.filter((r) => r.status !== 'pending')

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No requests yet"
        description="When your child asks for more time, an app or a website from their phone, it shows up here."
      />
    )
  }

  const row = (request) => {
    const type = TYPES[request.request_type] ?? { icon: Send, label: 'Request' }
    const d = describe(request)
    const [tone, label] = STATUS_BADGE[request.status] ?? STATUS_BADGE.pending
    const isPending = request.status === 'pending'
    return (
      <Card key={request.id} className="p-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
            <type.icon className="w-5 h-5" aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-primary-token truncate">{d.title}</p>
              {!isPending && <Badge variant={tone}>{label}</Badge>}
            </div>
            {request.reason && <p className="text-sm text-secondary-token mt-0.5">“{request.reason}”</p>}
            <p className="text-xs text-muted-token mt-1">
              {type.label} · {new Date(request.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            {isPending && (
              <p className={`flex items-start gap-1.5 text-xs mt-2 ${d.auto ? 'text-secondary-token' : 'text-[var(--color-warning)]'}`}>
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                {d.effect}
              </p>
            )}
          </div>
        </div>
        {isPending && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Button variant="secondary" icon={X} loading={busy === `${request.id}:false`} disabled={Boolean(busy)} onClick={() => handleResolve(request, false)}>
              Decline
            </Button>
            <Button icon={Check} loading={busy === `${request.id}:true`} disabled={Boolean(busy)} onClick={() => handleResolve(request, true)}>
              Approve
            </Button>
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-overline px-1">Waiting for you · {pending.length}</h3>
          {pending.map(row)}
        </section>
      )}
      {answered.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-overline px-1">Answered</h3>
          {answered.slice(0, 30).map(row)}
        </section>
      )}
    </div>
  )
}
