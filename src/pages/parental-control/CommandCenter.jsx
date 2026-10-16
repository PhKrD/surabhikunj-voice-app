import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  WifiOff, Lock, Gift, CloudOff, CheckCircle2, Loader2, ChevronDown, Info, Smartphone, X, Plus,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { useToast } from '@/store/toastStore'
import { friendlyError } from '@/lib/friendlyError'
import {
  listRecentCommands, subscribeToDeviceCommands, grantExtraTime, revokeExtraTime,
  setParentLock, setInternetPause,
} from '@/lib/parentalControlApi'
import {
  deriveCommandState, isDeviceOnline, isTerminalState, COMMAND_STATE_META, commandTypeLabel,
} from '@/lib/commandStatus'
import { controlStatus, controlStatusLabel } from '@/lib/desiredStateStatus'

const EXTRA_TIME_PRESETS = [15, 30, 60, 120]

function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleDateString()
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function minutesLeft(until, now) {
  return Math.max(0, Math.ceil((until.getTime() - now) / 60_000))
}

const STATUS_ICON = { applied: CheckCircle2, applying: Loader2, waiting: CloudOff, unknown: CloudOff }

/** One of the three big controls. `on` = the parent's intent is active. */
function ControlTile({ icon: Icon, onIcon: OnIcon = Icon, label, onLabel, on, tone, status, statusText, busy, onClick }) {
  const StatusIcon = status ? STATUS_ICON[status] : null
  const tones = {
    danger: 'bg-[var(--color-danger-soft)] border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning-soft)] border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] text-[var(--color-warning)]',
    success: 'bg-[var(--color-success-soft)] border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] text-[var(--color-success)]',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      className={cn(
        'press relative flex flex-col items-start gap-2 p-3.5 sm:p-4 rounded-[var(--radius-lg)] border text-left min-h-[7.5rem]',
        'transition-colors disabled:opacity-60',
        on ? tones[tone] : 'bg-[var(--surface)] border-[var(--border-color)] text-primary-token hover:border-[var(--border-strong)]',
      )}
    >
      <span className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center',
        on ? 'bg-[var(--surface)]/70' : 'bg-[var(--surface-muted)] text-secondary-token',
      )}>
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : on ? <OnIcon className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
      </span>
      <span className="text-sm font-bold leading-tight">{on ? onLabel : label}</span>
      {statusText && (
        <span className={cn('flex items-start gap-1 text-[11px] leading-tight font-medium', on ? 'opacity-90' : 'text-muted-token')}>
          {StatusIcon && <StatusIcon className={cn('w-3.5 h-3.5 flex-shrink-0', status === 'applying' && 'animate-spin')} aria-hidden="true" />}
          {statusText}
        </span>
      )}
    </button>
  )
}

/**
 * Command center: the parent's immediate controls over a child.
 *
 * Lock, internet pause and extra time are DESIRED STATE on the child
 * (pc_children, migration 72), not fire-and-forget commands — they work
 * whether or not a device is online this second. Each tile shows what the
 * PHONE has confirmed (desiredStateStatus.js), not just what was tapped,
 * so "Locked" is never claimed before the phone actually is.
 *
 * They apply to ALL of the child's devices because that is what the
 * underlying state is scoped to.
 */
export default function CommandCenter({ devices, childId, child, onChildUpdated, onRefreshDevices }) {
  const toast = useToast()
  const activeDevices = useMemo(() => devices.filter((d) => d.is_active), [devices])

  const [busy, setBusy] = useState(null)
  const [customMin, setCustomMin] = useState('')
  const [commands, setCommands] = useState([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [showExtraTime, setShowExtraTime] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // Flipped false if the database predates migration 72; the controls are
  // then command-only and DO depend on the device being reachable.
  const [durable, setDurable] = useState(true)

  const deviceIds = useMemo(() => activeDevices.map((d) => d.id), [activeDevices])
  const deviceById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices])
  const anyOnline = activeDevices.some((d) => isDeviceOnline(d, nowTick))

  // Parent's intent, straight from the child row. Falls back to what the
  // devices last reported on a database where migration 72 hasn't run.
  const reported = activeDevices.find((d) => d.enforcement_state)?.enforcement_state
  const locked = child?.parent_lock_active ?? reported?.lock_reason === 'parent_lock'
  const paused = child?.internet_pause_active ?? Boolean(reported?.manual_internet_pause)
  const bonusUntil = child?.bonus_expires_at ? new Date(child.bonus_expires_at) : null
  const bonusActive = bonusUntil != null && bonusUntil > new Date(nowTick)

  const lockStatus = controlStatus('lock', { parent_lock_active: locked }, activeDevices, nowTick)
  const pauseStatus = controlStatus('pause', { internet_pause_active: paused }, activeDevices, nowTick)

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const loadCommands = useCallback(async () => {
    if (deviceIds.length === 0) return
    try {
      setCommands(await listRecentCommands(deviceIds, { limit: 10 }))
    } catch {
      // History is secondary; the controls above still work without it.
    }
  }, [deviceIds])

  useEffect(() => {
    const id = setTimeout(() => loadCommands(), 0)
    return () => clearTimeout(id)
  }, [loadCommands])

  const mergeCommand = useCallback((row) => {
    if (!row?.id) return
    setCommands((prev) => [row, ...prev.filter((c) => c.id !== row.id)].slice(0, 10))
  }, [])

  useEffect(() => {
    if (deviceIds.length === 0) return undefined
    return subscribeToDeviceCommands(deviceIds, mergeCommand)
  }, [deviceIds, mergeCommand])

  /** Applies one desired-state change and reports honestly what will happen. */
  const apply = async (key, fn, { label, offlineNote }) => {
    setBusy(key)
    try {
      const result = await fn()
      if (result?.child) onChildUpdated?.(result.child)
      if (result?.durable === false) {
        setDurable(false)
        toast.info(label, 'Sent to the phone. Run migration 72 so this also survives the phone being offline.')
      } else if (anyOnline) {
        toast.success(label)
      } else {
        toast.info(`${label} — saved`, offlineNote)
      }
      loadCommands()
      onRefreshDevices?.()
      return true
    } catch (error) {
      toast.error(`Couldn’t ${label.toLowerCase()}`, friendlyError(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  const offlineNote = 'The phone is offline. It applies this the moment it’s back online.'

  const toggleLock = () =>
    apply('lock', () => setParentLock(childId, !locked), { label: locked ? 'Unlocked' : 'Locked', offlineNote })

  const togglePause = () =>
    apply('pause', () => setInternetPause(childId, !paused), { label: paused ? 'Internet resumed' : 'Internet paused', offlineNote })

  const giveExtraTime = async (minutes) => {
    const ok = await apply('bonus', () => grantExtraTime(childId, minutes), {
      label: `${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`} extra time given`,
      offlineNote,
    })
    if (ok) { setShowExtraTime(false); setCustomMin('') }
  }

  const endExtraTime = async () => {
    const ok = await apply('bonus', () => revokeExtraTime(childId), { label: 'Extra time ended', offlineNote })
    if (ok) setShowExtraTime(false)
  }

  if (activeDevices.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-5 text-center">
        <Smartphone className="w-6 h-6 mx-auto text-muted-token mb-2" />
        <p className="text-sm font-semibold text-primary-token">No phone linked yet</p>
        <p className="text-caption mt-1">Pair your child’s phone from Protection to lock it, pause the internet or give extra time.</p>
      </div>
    )
  }

  const custom = Math.round(Number(customMin))
  const customValid = custom > 0 && custom <= 24 * 60

  return (
    <section className="space-y-3" aria-label="Quick controls">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <ControlTile
          icon={Lock}
          onIcon={Lock}
          label="Lock now"
          onLabel="Locked"
          on={locked}
          tone="danger"
          busy={busy === 'lock'}
          status={durable ? lockStatus.status : null}
          statusText={locked || lockStatus.status !== 'applied'
            ? controlStatusLabel('lock', locked, lockStatus.status)
            : 'Calls stay available'}
          onClick={toggleLock}
        />
        <ControlTile
          icon={WifiOff}
          label="Pause internet"
          onLabel="Internet paused"
          on={paused}
          tone="warning"
          busy={busy === 'pause'}
          status={durable ? pauseStatus.status : null}
          statusText={paused || pauseStatus.status !== 'applied'
            ? controlStatusLabel('pause', paused, pauseStatus.status)
            : 'Offline apps still work'}
          onClick={togglePause}
        />
        <ControlTile
          icon={Gift}
          label="Extra time"
          onLabel={bonusActive ? `${minutesLeft(bonusUntil, nowTick)} min left` : 'Extra time'}
          on={bonusActive}
          tone="success"
          busy={busy === 'bonus'}
          statusText={bonusActive ? `Until ${clock(bonusUntil)} · tap to change` : 'Pauses limits for a while'}
          onClick={() => setShowExtraTime(true)}
        />
      </div>

      {locked && (
        <p className="flex items-start gap-2 text-caption px-1">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-token" aria-hidden="true" />
          Tap <span className="font-semibold text-secondary-token">Locked</span> again to unlock. Unlock can’t remove a PIN or pattern your child set on the phone itself — that’s an Android rule.
        </p>
      )}

      {!anyOnline && (
        <p className="flex items-start gap-2 text-sm rounded-[var(--radius-md)] px-3.5 py-3 bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
          <CloudOff className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          {durable
            ? <span>{activeDevices.length === 1 ? 'The phone is' : 'The phones are'} offline. Anything you change here is saved and applied automatically when {activeDevices.length === 1 ? 'it reconnects' : 'they reconnect'}.</span>
            : <span>The phone is offline, and this database still needs migration 72 — until then these controls only reach a phone that is online.</span>}
        </p>
      )}

      {activeDevices.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {activeDevices.map((d) => {
            const online = isDeviceOnline(d, nowTick)
            return (
              <span key={d.id} className="flex-shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium bg-[var(--surface-muted)] text-secondary-token">
                <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-[var(--color-success)]' : 'bg-[var(--border-strong)]')} />
                {d.device_name || 'Phone'}
                <span className="text-muted-token">{online ? 'online' : 'offline'}</span>
              </span>
            )
          })}
        </div>
      )}

      {commands.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-color)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="w-full flex items-center justify-between gap-2 px-4 h-11 text-sm font-semibold text-secondary-token"
          >
            Recent actions
            <ChevronDown className={cn('w-4 h-4 transition-transform', showHistory && 'rotate-180')} />
          </button>
          {showHistory && (
            <ul className="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
              {commands.map((cmd) => {
                const state = deriveCommandState(cmd, nowTick)
                const meta = COMMAND_STATE_META[state] ?? COMMAND_STATE_META.unknown
                const pending = !isTerminalState(state)
                // An expired command only means the fast path missed; the
                // desired state above is still on record and converging.
                const queued = state === 'timed_out'
                return (
                  <li key={cmd.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-primary-token truncate">
                        {commandTypeLabel(cmd.command_type)}
                        {activeDevices.length > 1 && <span className="text-muted-token"> · {deviceById[cmd.device_id]?.device_name || 'phone'}</span>}
                      </p>
                      <p className="text-xs text-muted-token truncate">
                        {timeAgo(cmd.created_at)}
                        {state === 'failed' && cmd.error_message ? ` · ${cmd.error_message}` : ''}
                      </p>
                    </div>
                    <Badge variant={queued ? 'default' : meta.tone} dot={pending}>{queued ? 'Saved' : meta.label}</Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={showExtraTime}
        onClose={() => setShowExtraTime(false)}
        title="Give extra time"
        description={bonusActive
          ? `Extra time runs until ${clock(bonusUntil)}. Adding more extends it.`
          : 'Daily limits, restricted hours and routines pause until it runs out. Your own Lock still wins.'}
      >
        <div className="grid grid-cols-2 gap-2">
          {EXTRA_TIME_PRESETS.map((m) => (
            <Button key={m} variant="secondary" size="lg" icon={Plus} disabled={busy === 'bonus'} onClick={() => giveExtraTime(m)}>
              {m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} min`}
            </Button>
          ))}
        </div>
        <form
          className="flex items-end gap-2 mt-3"
          onSubmit={(e) => { e.preventDefault(); if (customValid) giveExtraTime(custom) }}
        >
          <label className="flex-1">
            <span className="block text-sm font-semibold text-primary-token mb-1.5">Other amount (minutes)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              placeholder="e.g. 45"
            />
          </label>
          <Button type="submit" disabled={!customValid} loading={busy === 'bonus'}>Give</Button>
        </form>
        {bonusActive && (
          <Button variant="danger-soft" icon={X} className="w-full mt-4" disabled={busy === 'bonus'} onClick={endExtraTime}>
            End extra time now
          </Button>
        )}
      </Dialog>
    </section>
  )
}
