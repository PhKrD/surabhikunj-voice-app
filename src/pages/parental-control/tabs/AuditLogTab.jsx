import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { listAuditEvents } from '@/lib/parentalControlApi'

export default function AuditLogTab({ childId }) {
  const toast = useToastStore()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setEvents(await listAuditEvents(childId))
    } catch (error) {
      toast.error('Could not load audit log', error.message)
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

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-primary-token">Security audit log</h3>
          <Badge variant="default">Read-only</Badge>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-xl text-muted-token hover:text-saffron-500 hover:bg-saffron-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-10 px-6">
          <ShieldAlert className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">No audit events yet</p>
          <p className="text-xs text-muted-token mt-1">Security actions will be logged here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <Card key={event.id}>
              <CardBody className="py-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--surface-muted)] flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-4 h-4 text-secondary-token" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-primary-token text-sm font-mono">{event.action}</p>
                      {event.target && <span className="text-xs text-secondary-token">· {event.target}</span>}
                    </div>
                    {event.metadata && (
                      <p className="text-xs text-secondary-token mt-0.5 font-mono">{JSON.stringify(event.metadata)}</p>
                    )}
                    <p className="text-xs text-muted-token mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
