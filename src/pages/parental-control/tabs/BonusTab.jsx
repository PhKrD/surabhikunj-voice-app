import { useState, useEffect, useCallback } from 'react'
import { Gift, Check, X as XIcon } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listBonusRequests, resolveBonusRequest } from '@/lib/parentalControlApi'

const STATUS_VARIANT = { pending: 'yellow', approved: 'tulasi', denied: 'red' }

export default function BonusTab({ childId }) {
  const toast = useToastStore()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRequests(await listBonusRequests(childId))
    } catch (error) {
      toast.error('Could not load bonus requests', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const handleResolve = async (request, approve) => {
    setResolvingId(request.id)
    try {
      await resolveBonusRequest(request.id, { approve, approvedMin: request.requested_min })
      await load()
      toast.success(approve ? 'Bonus time granted' : 'Request denied')
    } catch (error) {
      toast.error('Could not resolve request', error.message)
    } finally {
      setResolvingId(null)
    }
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  if (requests.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <Gift className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No bonus time requests yet.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {requests.map((req) => (
        <Card key={req.id}>
          <CardBody className="py-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">
                +{req.requested_min} minutes
                {req.status === 'approved' && req.approved_min !== req.requested_min ? ` (granted ${req.approved_min})` : ''}
              </p>
              {req.reason && <p className="text-sm text-slate-500 truncate">"{req.reason}"</p>}
              <p className="text-xs text-slate-400 mt-0.5">{new Date(req.requested_at).toLocaleString()}</p>
            </div>
            {req.status === 'pending' ? (
              <div className="flex gap-1.5">
                <button
                  disabled={resolvingId === req.id}
                  onClick={() => handleResolve(req, false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                >
                  <XIcon className="w-4 h-4" />
                </button>
                <Button size="xs" icon={Check} loading={resolvingId === req.id} onClick={() => handleResolve(req, true)}>
                  Approve
                </Button>
              </div>
            ) : (
              <Badge variant={STATUS_VARIANT[req.status]}>{req.status}</Badge>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
