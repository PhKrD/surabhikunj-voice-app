/**
 * RestrictedTimesTab.jsx
 * Qustodio-style weekly hour grid: 7 days x 24 hours. Painted cells are
 * hours during which the child's device is restricted (apps blocked +
 * internet paused, optionally the screen locked, or internet-only).
 *
 * Stored as ONE row per child in pc_restricted_times (migration 70) and
 * enforced natively by PolicyEnforcer.kt (isRestrictedNow). Named
 * "Routines" (SchedulesTab) still exist for finer windows like 21:30–06:45
 * or allow-list-only modes; this grid is the fast "paint the week" view.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Save, Moon, Ban, Lock, WifiOff, Eraser, Sparkles, Info } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { getRestrictedTimes, upsertRestrictedTimes } from '@/lib/parentalControlApi'
import { restrictedCellSet, cellsFromSet } from '@/lib/screenTimePolicy'
import { cn } from '@/lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const ACTIONS = [
  { value: 'lock_navigation', label: 'Lock navigation', icon: Ban, desc: 'Apps blocked + internet paused. Calls and VOICE stay available.' },
  { value: 'lock_device', label: 'Lock device', icon: Lock, desc: 'Same, plus the screen is locked when the restricted hour starts.' },
  { value: 'block_internet', label: 'Internet only', icon: WifiOff, desc: 'Only the internet is paused; apps still work.' },
]

const PRESETS = [
  { label: 'School nights 21:00–07:00', apply: (set) => { for (const d of [0, 1, 2, 3, 4]) for (const h of [21, 22, 23]) set.add(`${d}:${h}`); for (const d of [1, 2, 3, 4, 5]) for (const h of [0, 1, 2, 3, 4, 5, 6]) set.add(`${d}:${h}`) } },
  { label: 'Every night 22:00–07:00', apply: (set) => { for (const d of DAYS.keys()) { for (const h of [22, 23, 0, 1, 2, 3, 4, 5, 6]) set.add(`${d}:${h}`) } } },
  { label: 'School hours Mon–Fri 08:00–15:00', apply: (set) => { for (const d of [1, 2, 3, 4, 5]) for (const h of [8, 9, 10, 11, 12, 13, 14]) set.add(`${d}:${h}`) } },
]

function hourLabel(h) {
  if (h === 0) return '12a'
  if (h < 12) return `${h}a`
  if (h === 12) return '12p'
  return `${h - 12}p`
}

export default function RestrictedTimesTab({ childId }) {
  const toast = useToastStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cells, setCells] = useState(() => new Set())
  const [action, setAction] = useState('lock_navigation')
  const [enabled, setEnabled] = useState(true)
  const [dirty, setDirty] = useState(false)

  // Drag-to-paint: mouse/touch down decides paint vs erase for the stroke.
  const paintMode = useRef(null)

  const load = useCallback(async () => {
    try {
      const row = await getRestrictedTimes(childId)
      setCells(restrictedCellSet(row.cells))
      setAction(row.action ?? 'lock_navigation')
      setEnabled(row.is_enabled !== false)
      setDirty(false)
    } catch (error) {
      toast.error('Could not load restricted times', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const setCell = (d, h, on) => {
    setCells((prev) => {
      const next = new Set(prev)
      const key = `${d}:${h}`
      if (on) next.add(key); else next.delete(key)
      return next
    })
    setDirty(true)
  }

  const startPaint = (d, h) => {
    const on = !cells.has(`${d}:${h}`)
    paintMode.current = on
    setCell(d, h, on)
  }
  const continuePaint = (d, h) => {
    if (paintMode.current === null) return
    setCell(d, h, paintMode.current)
  }
  const endPaint = () => { paintMode.current = null }

  useEffect(() => {
    window.addEventListener('mouseup', endPaint)
    window.addEventListener('touchend', endPaint)
    return () => {
      window.removeEventListener('mouseup', endPaint)
      window.removeEventListener('touchend', endPaint)
    }
  }, [])

  const toggleWholeDay = (d) => {
    const allOn = HOURS.every((h) => cells.has(`${d}:${h}`))
    setCells((prev) => {
      const next = new Set(prev)
      for (const h of HOURS) { if (allOn) next.delete(`${d}:${h}`); else next.add(`${d}:${h}`) }
      return next
    })
    setDirty(true)
  }

  const toggleWholeHour = (h) => {
    const allOn = DAYS.every((_, d) => cells.has(`${d}:${h}`))
    setCells((prev) => {
      const next = new Set(prev)
      DAYS.forEach((_, d) => { if (allOn) next.delete(`${d}:${h}`); else next.add(`${d}:${h}`) })
      return next
    })
    setDirty(true)
  }

  const applyPreset = (preset) => {
    setCells((prev) => { const next = new Set(prev); preset.apply(next); return next })
    setDirty(true)
  }

  const clearAll = () => { setCells(new Set()); setDirty(true) }

  const save = async () => {
    setSaving(true)
    try {
      await upsertRestrictedTimes({ childId, cells: cellsFromSet(cells), action, isEnabled: enabled })
      setDirty(false)
      toast.success('Restricted times saved')
    } catch (error) {
      toast.error('Could not save', error.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  const totalHours = cells.size
  const now = new Date()
  const nowKey = `${now.getDay()}:${now.getHours()}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary-token flex items-center gap-2"><Moon className="w-4 h-4 text-indigo-500" /> Restricted times</h3>
          <p className="text-xs text-muted-token mt-0.5">
            Tap or drag over the hours when the device should be restricted. {totalHours} hour{totalHours === 1 ? '' : 's'}/week selected.
          </p>
        </div>
        <button
          onClick={() => { setEnabled((v) => !v); setDirty(true) }}
          className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
          title={enabled ? 'Restricted times on' : 'Restricted times off'}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <Card>
        <CardBody className="py-4 overflow-x-auto">
          <div className={cn('select-none', !enabled && 'opacity-50')} style={{ minWidth: 560 }} onMouseLeave={endPaint}>
            {/* Hour header */}
            <div className="grid" style={{ gridTemplateColumns: '44px repeat(24, minmax(0, 1fr))' }}>
              <div />
              {HOURS.map((h) => (
                <button
                  key={h}
                  onClick={() => toggleWholeHour(h)}
                  className="text-[9px] text-muted-token hover:text-indigo-600 text-center py-1 leading-none"
                  title={`Toggle ${hourLabel(h)} on every day`}
                >
                  {h % 3 === 0 ? hourLabel(h) : ''}
                </button>
              ))}
            </div>
            {DAYS.map((day, d) => (
              <div key={day} className="grid items-center" style={{ gridTemplateColumns: '44px repeat(24, minmax(0, 1fr))' }}>
                <button
                  onClick={() => toggleWholeDay(d)}
                  className={cn('text-xs font-medium text-left pr-2 py-1', d === now.getDay() ? 'text-indigo-600' : 'text-secondary-token', 'hover:text-indigo-600')}
                  title={`Toggle all of ${day}`}
                >
                  {day}
                </button>
                {HOURS.map((h) => {
                  const key = `${d}:${h}`
                  const on = cells.has(key)
                  return (
                    <div
                      key={h}
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${day} ${hourLabel(h)}`}
                      onMouseDown={(e) => { e.preventDefault(); startPaint(d, h) }}
                      onMouseEnter={() => continuePaint(d, h)}
                      onTouchStart={() => startPaint(d, h)}
                      className={cn(
                        'h-7 m-[1px] rounded-[3px] cursor-pointer transition-colors border',
                        on ? 'bg-indigo-500 border-indigo-600' : 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100',
                        key === nowKey && 'ring-2 ring-saffron-400 ring-offset-1',
                      )}
                    />
                  )
                })}
              </div>
            ))}
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-token">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-200" /> Allowed</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500" /> Restricted</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-saffron-400" /> Now</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs text-secondary-token hover:bg-[var(--surface-muted)]"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> {p.label}
          </button>
        ))}
        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs text-secondary-token hover:bg-red-50 hover:text-red-600"
        >
          <Eraser className="w-3.5 h-3.5" /> Clear all
        </button>
      </div>

      <Card>
        <CardBody className="py-4 space-y-3">
          <p className="text-xs font-semibold text-muted-token uppercase tracking-wide">During restricted hours</p>
          <div className="grid grid-cols-1 gap-2">
            {ACTIONS.map((act) => {
              const Icon = act.icon
              return (
                <button
                  key={act.value}
                  type="button"
                  onClick={() => { setAction(act.value); setDirty(true) }}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-lg border text-left text-sm transition-colors',
                    action === act.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-[var(--border-color)] hover:border-slate-300 text-primary-token',
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <div>
                    <span className="font-medium">{act.label}</span>
                    <p className="text-xs opacity-70">{act.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-token">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Extra time you grant pauses restrictions until it expires. Emergency calls, the dialer and VOICE itself are never blocked.
          </p>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>
          Save restricted times
        </Button>
      </div>
    </div>
  )
}
