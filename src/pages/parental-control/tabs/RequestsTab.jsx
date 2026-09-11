import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, Send, Info } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listChildRequests, resolveChildRequest } from '@/lib/parentalControlApi'

// Only bonus_time carries a structured payload (minutes) the child app
// sends — app_unblock/website_access/schedule_exception are freeform text
// (see RequestPage.jsx on the child device), so approving them can only
// flip the request's status. There's nothing safe to automate from free
// text, so we're honest about it here rather than pretending it acts on
// the device — the parent still needs to make the matching change in
// Rules / Website Rules themselves.
const REQUEST_ICONS = {
  bonus_time: { icon: Clock, label: 'Bonus time', autoActs: true },
  app_unblock: { icon: Send, label: 'App unblock', autoActs: false },
  website_access: { icon: Send, label: 'Website access', autoActs: false },
  schedule_exception: { icon: Clock, label: 'Schedule exception', autoActs: false },
}

export default function RequestsTab({ childId }) {
  const toast = useToastStore()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRequests(await listChildRequests(childId))
    } catch (error) {
      toast.error('Could not load requests', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  const handleResolve = async (request, approve) => {
    try {
      await resolveChildRequest(request.id, { approve, bonusMinutes: request.metadata?.minutes || 30 })
      toast.success(approve ? 'Request approved' : 'Request denied')
      await load()
    } catch (error) {
      toast.error('Could not resolve request', error.message)
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary-token">Child requests</h3>
          {pendingCount > 0 && <Badge variant="red">{pendingCount} pending</Badge>}
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-xl text-muted-token hover:text-saffron-500 hover:bg-saffron-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-10 px-6">
          <Send className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">No requests yet</p>
          <p className="text-xs text-muted-token mt-1">When your child asks for something, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => {
            const iconInfo = REQUEST_ICONS[request.request_type] || REQUEST_ICONS.bonus_time
            const Icon = iconInfo.icon
            return (
              <Card key={request.id}>
                <CardBody className="py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-muted)] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-secondary-token" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-primary-token">{iconInfo.label}</p>
                        <Badge variant={request.status === 'approved' ? 'tulasi' : request.status === 'denied' ? 'red' : 'yellow'}>
                          {request.status}
                        </Badge>
                      </div>
                      {request.reason && <p className="text-sm text-secondary-token mt-0.5">{request.reason}</p>}
                      {request.metadata?.minutes && (
                        <p className="text-xs text-secondary-token mt-0.5">Requested: {request.metadata.minutes} minutes</p>
                      )}
                      <p className="text-xs text-muted-token mt-1">{new Date(request.created_at).toLocaleString()}</p>
                      {!iconInfo.autoActs && request.status === 'pending' && (
                        <p className="flex items-start gap-1 text-xs text-saffron-600 dark:text-saffron-400 mt-2">
                          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          Approving only updates this request's status. You'll still need to make the matching
                          change yourself in {request.request_type === 'website_access' ? 'Website Rules' : 'Rules'}.
                        </p>
                      )}
                    </div>
                    {request.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => handleResolve(request, false)}>
                          <XCircle className="w-4 h-4" />
                        </Button>
                        <Button size="sm" onClick={() => handleResolve(request, true)}>
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
