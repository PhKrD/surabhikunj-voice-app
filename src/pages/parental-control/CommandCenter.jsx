import { useState, useEffect, useCallback, useMemo } from 'react'
import { WifiOff, Wifi, Lock, LockOpen, Smartphone, RefreshCw, Info, Gift, X, CloudOff } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import {
  listRecentCommands, subscribeToDeviceCommands, grantExtraTime, revokeExtraTime,
  setParentLock, setInternetPause,
} from '@/lib/parentalControlApi'
import {
  deriveCommandState,
  isDeviceOnline,
  isTerminalState,
  COMMAND_STATE_META,
  commandTypeLabel,
} from '@/lib/commandStatus'

const EXTRA_TIME_PRESETS = [15, 30, 60, 120]

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Command center: the parent's immediate controls over a child.
 *
 * Lock, internet pause and extra time are DESIRED STATE on the child
 * (pc_children, migration 72), not fire-and-forget commands — so they are
 * deliberately modelled here as toggles reflecting the current intent, and
 * they work whether or not a device is online this second. An offline
 * device applies them when it reconnects; the UI says so rather than
 * showing a scary "timed out".
 *
 * They apply to ALL of the child's devices because that is what the
 * underlying state is scoped to; the device list below is status, not a
 * target picker.
 */
export default function CommandCenter({ devices, childId, child, onChildUpdated, onRefreshDevices }) {
  const toast = useToastStore()
  const activeDevices = useMemo(() => devices.filter((d) => d.is_active), [devices])

  const [sending, setSending] = useState(false)
  const [commands, setCommands] = useState([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [showExtraTime, setShowExtraTime] = useState(false)
  // Flipped false if the database turns out to predate migration 72, in
  // which case these controls are command-only and DO depend on the device
  // being reachable — the offline note below must not claim otherwise.
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

  // A clock so timed-out states surface even without a DB event.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const loadCommands = useCallback(async () => {
    if (deviceIds.length === 0) return
    try {
      setCommands(await listRecentCommands(deviceIds, { limit: 15 }))
    } catch (error) {
      toast.error('Could not load command history', error.message)
    }
  }, [deviceIds, toast])

  useEffect(() => {
    const id = setTimeout(() => loadCommands(), 0)
    return () => clearTimeout(id)
  }, [loadCommands])

  // Merge an inserted/updated command row into local state (dedup by id).
  const mergeCommand = useCallback((row) => {
    if (!row?.id) return
    setCommands((prev) => [row, ...prev.filter((c) => c.id !== row.id)].slice(0, 15))
  }, [])

  // Live updates from Realtime.
  useEffect(() => {
    if (deviceIds.length === 0) return undefined
    return subscribeToDeviceCommands(deviceIds, mergeCommand)
  }, [deviceIds, mergeCommand])

  /** Applies one desired-state change and reports honestly what will happen. */
  const apply = async (fn, { label, queuedNote }) => {
    setSending(true)
    try {
      const result = await fn()
      if (result?.child) onChildUpdated?.(result.child)
      if (result?.durable === false) {
        // Migration 72 hasn't been applied, so there is no durable intent
        // behind this — don't promise it survives going offline.
        setDurable(false)
        toast.info(label, 'Sent to the device. Run migration 72 so this also survives the device being offline.')
      } else if (anyOnline) {
        toast.success(label, 'Applying now — tracking status below.')
      } else {
        toast.info(`${label} — queued`, queuedNote)
      }
      loadCommands()
      onRefreshDevices?.()
    } catch (error) {
      toast.error(`Could not ${label.toLowerCase()}`, error.message)
    } finally {
      setSending(false)
    }
  }

  const toggleLock = () =>
    apply(() => setParentLock(childId, !locked), {
      label: locked ? 'Unlocked' : 'Locked',
      queuedNote: "The device is offline. It will apply this the moment it's back online.",
    })

  const togglePause = () =>
    apply(() => setInternetPause(childId, !paused), {
      label: paused ? 'Internet resumed' : 'Internet paused',
      queuedNote: "The device is offline. It will apply this the moment it's back online.",
    })

  const giveExtraTime = async (minutes) => {
    setShowExtraTime(false)
    await apply(() => grantExtraTime(childId, minutes), {
      label: `${minutes} extra minutes granted`,
      queuedNote: 'The device is offline. It will pick this up when it reconnects.',
    })
  }

  const endExtraTime = async () => {
    setShowExtraTime(false)
    await apply(() => revokeExtraTime(childId), {
      label: 'Extra time ended',
      queuedNote: 'The device is offline. It will pick this up when it reconnects.',
    })
  }

  if (activeDevices.length === 0) {
    return (
      <div className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] p-5 text-center text-sm text-muted-token">
        No active devices. Add a device from the Devices tab to send commands.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Device status — informational. Lock/pause apply to every device. */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {activeDevices.map((d) => {
          const online = isDeviceOnline(d, nowTick)
          return (
            <span
              key={d.id}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border bg-[var(--surface)] text-secondary-token border-[var(--border-color)]"
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-tulasi-400' : 'bg-slate-300')} />
              {d.device_name || 'Unnamed'}
              <span className="font-normal text-muted-token">{online ? 'online' : 'offline'}</span>
            </span>
          )
        })}
      </div>

      {/* State toggles */}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={sending}
          onClick={togglePause}
          title={paused ? 'Let this child back online' : 'Keep every app that needs a connection off screen'}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            paused
              ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
              : 'bg-[var(--surface)] border-[var(--border-color)] text-secondary-token hover:border-red-200 hover:text-red-600',
          )}
        >
          {paused ? <Wifi className="w-4.5 h-4.5" /> : <WifiOff className="w-4.5 h-4.5" />}
          {paused ? 'Resume internet' : 'Pause internet'}
        </button>

        <button
          disabled={sending}
          onClick={toggleLock}
          title={locked ? 'Release your lock' : 'Keep every app off-screen (calls + VOICE stay available)'}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            locked
              ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
              : 'bg-[var(--surface)] border-[var(--border-color)] text-secondary-token hover:border-slate-400',
          )}
        >
          {locked ? <LockOpen className="w-4.5 h-4.5" /> : <Lock className="w-4.5 h-4.5" />}
          {locked ? 'Unlock' : 'Lock now'}
        </button>

        <button
          disabled={sending}
          onClick={() => setShowExtraTime((v) => !v)}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-semibold disabled:opacity-50',
            bonusActive
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
              : showExtraTime
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'bg-[var(--surface)] border-[var(--border-color)] text-secondary-token hover:border-indigo-200 hover:text-indigo-600',
          )}
          title="Pause every limit, routine and restriction for a while"
        >
          <Gift className="w-4.5 h-4.5" />
          {bonusActive ? `Extra time until ${bonusUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Give extra time'}
        </button>

        <button
          onClick={() => { loadCommands(); onRefreshDevices?.() }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[var(--surface)] border border-[var(--border-color)] text-sm font-medium text-muted-token hover:text-secondary-token"
          title="Refresh status"
        >
          <RefreshCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {showExtraTime && (
        <div className="rounded-3xl border border-indigo-200 bg-indigo-50/60 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-800 mr-1">Extra time:</span>
          {EXTRA_TIME_PRESETS.map((m) => (
            <button
              key={m}
              disabled={sending}
              onClick={() => giveExtraTime(m)}
              className="px-4 py-2 rounded-xl bg-white border border-indigo-200 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              +{m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
          <button
            disabled={sending}
            onClick={endExtraTime}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <X className="w-4 h-4" /> End extra time now
          </button>
        </div>
      )}

      {/* Honest offline behaviour: these are durable intents, not lost taps. */}
      {!anyOnline && (
        <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <CloudOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {durable ? (
            <span>
              {activeDevices.length === 1 ? 'This device is' : 'These devices are'} offline right now. Lock,
              internet pause and extra time are saved as instructions and applied automatically the moment
              {activeDevices.length === 1 ? ' it reconnects' : ' they reconnect'} — you don&apos;t need to tap again.
            </span>
          ) : (
            <span>
              {activeDevices.length === 1 ? 'This device is' : 'These devices are'} offline right now, and this
              database still needs migration 72 — until it is applied these controls only reach a device that is
              online, so this may not take effect.
            </span>
          )}
        </p>
      )}

      {/* Real Android constraint, surfaced here rather than only in a doc no
          parent will read: "Lock now" keeps apps off-screen via the
          Accessibility soft-lock (no reset needed) and locks the screen once.
          Dismissing an EXISTING PIN/pattern/password from here needs a
          Device-Owner-only API. See PLATFORM_LIMITATIONS.md. */}
      <p className="flex items-start gap-2 text-sm text-muted-token">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        Lock and internet pause stay in force until you switch them off here. Pausing the internet keeps every
        app that needs a connection off screen (offline apps and calls still work); if the device also has the optional
        VPN permission, background traffic stops too. Unlock can&apos;t remove a PIN/pattern the child set on the phone
        itself — that&apos;s an Android restriction, not a bug here.
      </p>

      {/* Live command status feed */}
      {commands.length > 0 && (
        <div className="rounded-3xl border border-[var(--border-color)] bg-[var(--surface)] divide-y divide-[var(--border-color)]">
          <p className="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-wide text-muted-token">
            Recent commands
          </p>
          {commands.map((cmd) => {
            const state = deriveCommandState(cmd, nowTick)
            const meta = COMMAND_STATE_META[state] ?? COMMAND_STATE_META.unknown
            const dev = deviceById[cmd.device_id]
            const pending = !isTerminalState(state)
            // A command that expired only means the fast path missed; the
            // desired state above is still on record and still converging.
            const queued = state === 'timed_out'
            return (
              <div key={cmd.id} className="px-5 py-3 flex items-center gap-3">
                <Smartphone className="w-4.5 h-4.5 text-muted-token flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary-token truncate">
                    {commandTypeLabel(cmd.command_type)}
                    <span className="text-muted-token font-normal"> · {dev?.device_name || 'device'}</span>
                  </p>
                  <p className="text-xs text-muted-token truncate">
                    {timeAgo(cmd.created_at)}
                    {state === 'failed' && cmd.error_message ? ` · ${cmd.error_message}` : ''}
                    {queued ? ' · saved, applies when the device is back' : ''}
                  </p>
                </div>
                <Badge variant={queued ? 'default' : meta.tone} dot={pending}>
                  {queued ? 'Queued' : meta.label}
                </Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
