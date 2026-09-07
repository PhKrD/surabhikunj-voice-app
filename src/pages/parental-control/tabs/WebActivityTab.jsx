import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Globe, RefreshCw, Info } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { listWebActivity, subscribeToWebActivity } from '@/lib/parentalControlApi'

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function WebActivityTab({ childId }) {
  const toast = useToastStore()
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all') // all | visit | search

  const load = useCallback(async () => {
    try {
      setActivity(await listWebActivity(childId, { limit: 150 }))
    } catch (error) {
      toast.error('Could not load web activity', error.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    return subscribeToWebActivity(childId, (row) => {
      setActivity((prev) => [row, ...prev])
    })
  }, [childId])

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  const filtered = useMemo(
    () => (filter === 'all' ? activity : activity.filter((a) => a.activity_type === filter)),
    [activity, filter],
  )

  const groups = useMemo(() => {
    const byDay = new Map()
    for (const row of filtered) {
      const label = dayLabel(row.occurred_at)
      if (!byDay.has(label)) byDay.set(label, [])
      byDay.get(label).push(row)
    }
    return Array.from(byDay.entries())
  }, [filtered])

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      {/* Honesty banner — this is a best-effort signal, not exhaustive
          monitoring. Mirrors the pattern used in WebsiteRulesTab.jsx. */}
      <div className="flex items-start gap-2 rounded-xl border border-saffron-100 dark:border-saffron-900/50 bg-saffron-50 dark:bg-saffron-950/30 px-3 py-2.5 text-xs text-saffron-800 dark:text-saffron-300">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          Best-effort signal, not a complete browsing log. Only recognizes supported browsers
          (Chrome, Samsung Internet, Edge, Firefox and a few others), requires the parent to have
          enabled Accessibility for VOICE on the child's device, and may miss activity if a
          browser updates its interface. See PLATFORM_LIMITATIONS.md.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {[
            { key: 'all', label: 'All' },
            { key: 'visit', label: 'Sites' },
            { key: 'search', label: 'Searches' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === f.key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'surface-muted text-secondary-token hover:text-primary-token'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-xl text-muted-token hover:text-[var(--color-primary)] hover:bg-[var(--surface-muted)] transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-10 px-6">
          <Globe className="w-8 h-8 text-muted-token mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-token">No web activity yet</p>
          <p className="text-xs text-muted-token mt-1">
            Nothing has been reported yet — check the device has Accessibility enabled for VOICE.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([label, rows]) => (
            <div key={label}>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-token mb-2">{label}</p>
              <Card>
                <CardBody className="!p-0 divide-y divide-[var(--border-color)]">
                  {rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-8 h-8 rounded-lg surface-muted flex items-center justify-center flex-shrink-0">
                        {row.activity_type === 'search'
                          ? <Search className="w-4 h-4 text-secondary-token" />
                          : <Globe className="w-4 h-4 text-secondary-token" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {row.activity_type === 'search' ? (
                          <p className="text-sm font-medium text-primary-token truncate">
                            "{row.search_query}"
                            <span className="text-muted-token font-normal"> · {row.search_engine ?? 'search'}</span>
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-primary-token truncate">{row.domain}</p>
                        )}
                        <p className="text-xs text-muted-token">{new Date(row.occurred_at).toLocaleTimeString()}</p>
                      </div>
                      <Badge variant={row.activity_type === 'search' ? 'lotus' : 'default'} className="text-[11px] flex-shrink-0">
                        {row.activity_type === 'search' ? 'Search' : 'Visit'}
                      </Badge>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
