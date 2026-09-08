import { useState, useEffect, useCallback, useMemo } from 'react'
import { WifiOff, Wifi, Lock, LockOpen, Smartphone, RefreshCw, Info } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import useToastStore from '@/store/toastStore'
import { sendDeviceCommand, listRecentCommands, subscribeToDeviceCommands } from '@/lib/parentalControlApi'
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
  { type: 'unlock_device',   label: 'Unlock now',      icon: LockOpen, capability: 'unlockDevice',   hover: 'hover:border-emerald-200 hover:text-emerald-600' },
]

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
export default function CommandCenter({ devices }) {
  const toast = useToastStore()
  const activeDevices = useMemo(() => devices.filter((d) => d.is_active), [devices])

  // Target selection: null = all active devices, otherwise a device id.
  const [target, setTarget] = useState('all')
  const [sending, setSending] = useState(false)
  const [commands, setCommands] = useState([])
  const [nowTick, setNowTick] = useState(() => Date.now())

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

  if (activeDevices.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface)] p-4 text-center text-sm text-muted-token">
        No active devices. Add a device from the Devices tab to send commands.
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
          // "Unlock now" needs setKeyguardDisabled(), a Device-Owner-only
          // API — the default no-reset setup (Device Admin) can never do
          // this, so it's gated on the optional Advanced mode being active
          // rather than just platform support. See PLATFORM_LIMITATIONS.md.
          const platformSupported = targetDevices.some((d) => deviceSupports(d, action.capability))
          const supported = action.type === 'unlock_device'
            ? platformSupported && targetDevices.some((d) => d.enforcement_state?.device_owner === true)
            : platformSupported
          const title = action.type === 'unlock_device' && platformSupported && !supported
            ? 'Unlock isn\u2019t available — this device uses the standard (Device Admin) setup, not the optional Advanced (Device Owner) mode required to dismiss an existing lock screen'
            : supported ? action.label : `${action.label} not supported on this device`
          return (
            <button
              key={action.type}
              disabled={sending || !supported}
              onClick={() => fire(action)}
              title={title}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] text-sm font-medium text-secondary-token disabled:opacity-50 disabled:cursor-not-allowed',
                action.hover,
              )}
            >
              <Icon className="w-4 h-4" /> {action.label}
            </button>
          )
        })}
        <button
          onClick={loadCommands}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border-color)] text-sm font-medium text-muted-token hover:text-secondary-token"
          title="Refresh command status"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Real Android constraint, surfaced here rather than only in a doc no
          parent will read: with the standard (Device Admin, no factory
          reset) setup, "Unlock now" is unavailable entirely — dismissing an
          EXISTING PIN/pattern/password needs a Device-Owner-only API. Only
          the optional Advanced (Device Owner) mode, which does require a
          factory reset, can do that. See PLATFORM_LIMITATIONS.md. */}
      <p className="flex items-start gap-1.5 text-xs text-muted-token">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        "Unlock now" only works on devices set up in the optional Advanced (Device Owner) mode, and even
        then can't remove an existing PIN/pattern/password — that's an Android restriction, not a bug here.
      </p>

      {/* Live command status feed */}
      {commands.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface)] divide-y divide-[var(--border-color)]">
          <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted-token">
            Recent commands
          </p>
          {commands.map((cmd) => {
            const state = deriveCommandState(cmd, nowTick)
            const meta = COMMAND_STATE_META[state] ?? COMMAND_STATE_META.unknown
            const dev = deviceById[cmd.device_id]
            const pending = !isTerminalState(state)
            return (
              <div key={cmd.id} className="px-4 py-2.5 flex items-center gap-3">
                <Smartphone className="w-4 h-4 text-muted-token flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary-token truncate">
                    {commandTypeLabel(cmd.command_type)}
                    <span className="text-muted-token font-normal"> · {dev?.device_name || 'device'}</span>
                  </p>
                  <p className="text-[11px] text-muted-token truncate">
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
