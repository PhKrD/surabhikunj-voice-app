import { useState, useEffect, useCallback, useMemo } from 'react'
import { WifiOff, Wifi, Lock, LockOpen, Smartphone, RefreshCw, Info, Gift, X } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { sendDeviceCommand, listRecentCommands, subscribeToDeviceCommands, grantExtraTime, revokeExtraTime } from '@/lib/parentalControlApi'
import {
  deriveCommandState,
  isDeviceOnline,
  isTerminalState,
  COMMAND_STATE_META,
  commandTypeLabel,
} from '@/lib/commandStatus'
import { deviceSupports } from '@/lib/deviceCapabilities'

const ACTIONS = [
  { type: 'pause_internet',  label: 'Pause internet',  icon: WifiOff,  capability: 'pauseInternet',  hover: 'hover:border-red-200 hover:text-red-600' },
  { type: 'resume_internet', label: 'Resume internet', icon: Wifi,     capability: 'resumeInternet', hover: 'hover:border-tulasi-200 hover:text-tulasi-600' },
  { type: 'lock_device',     label: 'Lock now',        icon: Lock,     capability: 'lockDevice',     hover: 'hover:border-slate-400' },
  { type: 'unlock_device',   label: 'Unlock',          icon: LockOpen, capability: 'unlockDevice',   hover: 'hover:border-emerald-200 hover:text-emerald-600' },
]

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
 * Command center: pick target device(s), fire actions, and watch each
 * command's TRUE lifecycle state (pending → sent → executed/failed/timed-out)
 * instead of a premature success toast.
 */
export default function CommandCenter({ devices, childId }) {
  const toast = useToastStore()
  const activeDevices = useMemo(() => devices.filter((d) => d.is_active), [devices])

  // Target selection: null = all active devices, otherwise a device id.
  const [target, setTarget] = useState('all')
  const [sending, setSending] = useState(false)
  const [commands, setCommands] = useState([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [showExtraTime, setShowExtraTime] = useState(false)

  const deviceIds = useMemo(() => activeDevices.map((d) => d.id), [activeDevices])
  const deviceById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices])

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

  const targetDevices = target === 'all' ? activeDevices : activeDevices.filter((d) => d.id === target)

  const fire = async (action) => {
    if (targetDevices.length === 0) {
      toast.error('No active device selected')
      return
    }
    // Respect platform capabilities — never send an unsupported command.
    const capable = targetDevices.filter((d) => deviceSupports(d, action.capability))
    if (capable.length === 0) {
      toast.error(`${action.label} isn't supported on the selected device`)
      return
    }
    setSending(true)
    try {
      const created = await Promise.all(
        capable.map((d) => sendDeviceCommand({ deviceId: d.id, commandType: action.type })),
      )
      // Optimistically show the new pending rows; realtime will update them.
      created.forEach((row) => mergeCommand(row))
      toast.info(`${action.label} sent — tracking status below`)
    } catch (error) {
      toast.error('Could not send command', error.message)
    } finally {
      setSending(false)
    }
  }

  const giveExtraTime = async (minutes) => {
    setSending(true)
    try {
      const res = await grantExtraTime(childId, minutes)
      toast.success(`${minutes} extra minutes granted`, `Limits and restrictions pause on ${res.devices} device${res.devices === 1 ? '' : 's'} until then.`)
      setShowExtraTime(false)
      loadCommands()
    } catch (error) {
      toast.error('Could not grant extra time', error.message)
    } finally {
      setSending(false)
    }
  }

  const endExtraTime = async () => {
    setSending(true)
    try {
      await revokeExtraTime(childId)
      toast.info('Extra time ended')
      setShowExtraTime(false)
      loadCommands()
    } catch (error) {
      toast.error('Could not end extra time', error.message)
    } finally {
      setSending(false)
    }
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
      {/* Target selector */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <TargetChip
          active={target === 'all'}
          onClick={() => setTarget('all')}
          label={`All devices (${activeDevices.length})`}
        />
        {activeDevices.map((d) => (
          <TargetChip
            key={d.id}
            active={target === d.id}
            onClick={() => setTarget(d.id)}
            label={d.device_name || 'Unnamed'}
            online={isDeviceOnline(d, nowTick)}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon
          const supported = targetDevices.some((d) => deviceSupports(d, action.capability))
          const title = supported
            ? action.type === 'lock_device'
              ? 'Keeps every app off-screen (calls + VOICE stay available) until you tap Unlock'
              : action.type === 'unlock_device'
                ? 'Releases your lock. Cannot dismiss a PIN/pattern screen the child set — that is an Android restriction'
                : action.label
            : `${action.label} not supported on this device`
          return (
            <button
              key={action.type}
              disabled={sending || !supported}
              onClick={() => fire(action)}
              title={title}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[var(--surface)] border border-[var(--border-color)] text-sm font-medium text-secondary-token disabled:opacity-50 disabled:cursor-not-allowed',
                action.hover,
              )}
            >
              <Icon className="w-4.5 h-4.5" /> {action.label}
            </button>
          )
        })}
        {childId && (
          <button
            disabled={sending}
            onClick={() => setShowExtraTime((v) => !v)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-medium disabled:opacity-50',
              showExtraTime ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-[var(--surface)] border-[var(--border-color)] text-secondary-token hover:border-indigo-200 hover:text-indigo-600',
            )}
            title="Pause every limit, routine and restriction for a while"
          >
            <Gift className="w-4.5 h-4.5" /> Give extra time
          </button>
        )}
        <button
          onClick={loadCommands}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[var(--surface)] border border-[var(--border-color)] text-sm font-medium text-muted-token hover:text-secondary-token"
          title="Refresh command status"
        >
          <RefreshCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {showExtraTime && (
        <div className="rounded-3xl border border-indigo-200 bg-indigo-50/60 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-800 mr-1">Extra time for all devices:</span>
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

      {/* Real Android constraint, surfaced here rather than only in a doc no
          parent will read: "Lock now" keeps apps off-screen via the
          Accessibility soft-lock (no reset needed) and locks the screen once.
          Dismissing an EXISTING PIN/pattern/password from here needs a
          Device-Owner-only API. See PLATFORM_LIMITATIONS.md. */}
      <p className="flex items-start gap-2 text-sm text-muted-token">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        &quot;Lock now&quot; and &quot;Pause internet&quot; both stay in force until you undo them. Pausing the internet keeps every
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
                  </p>
                </div>
                <Badge variant={meta.tone} dot={pending}>
                  {meta.label}
                </Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TargetChip({ active, onClick, label, online }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors',
        active
          ? 'bg-indigo-500 text-white border-indigo-500'
          : 'bg-[var(--surface)] text-secondary-token border-[var(--border-color)] hover:border-slate-300',
      )}
    >
      {online != null && (
        <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-tulasi-400' : 'bg-slate-300')} />
      )}
      {label}
    </button>
  )
}
