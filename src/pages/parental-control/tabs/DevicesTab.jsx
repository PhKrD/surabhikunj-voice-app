import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Clock, ShieldCheck, ShieldAlert, ShieldOff, ArrowLeftRight, ChevronDown, ChevronUp, CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listDevices, generatePairingCode, removeDevice, reassignDevice, listChildren } from '@/lib/parentalControlApi'
import { isDeviceOnline } from '@/lib/commandStatus'
import { derivePolicySyncState, POLICY_SYNC_META, diagnosticChecklist } from '@/lib/policySync'

const OWNER_MODE_META = {
  device_owner: { label: 'Fully managed', icon: ShieldCheck, variant: 'tulasi' },
  device_admin: { label: 'Limited (Device Admin)', icon: ShieldAlert, variant: 'yellow' },
  none: { label: 'Not enrolled', icon: ShieldOff, variant: 'default' },
}

export default function DevicesTab({ childId }) {
  const toast = useToastStore()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [deviceName, setDeviceName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [pairing, setPairing] = useState(null) // { pairing_code, expires_at }
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [otherChildren, setOtherChildren] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const [devs, children] = await Promise.all([listDevices(childId), listChildren()])
      setDevices(devs)
      setOtherChildren(children.filter((c) => c.id !== childId))
    } catch (error) {
      toast.error('Could not load devices', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  const handleReassign = async (device, newChildId) => {
    if (!newChildId) return
    try {
      await reassignDevice(device.id, newChildId)
      await loadDevices()
      toast.success('Device reassigned')
    } catch (error) {
      toast.error('Could not reassign device', error.message)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => loadDevices(), 0)
    return () => clearTimeout(id)
  }, [loadDevices])

  // Countdown for the active pairing code
  useEffect(() => {
    if (!pairing) return
    const tick = () => {
      const secs = Math.max(0, Math.round((new Date(pairing.expires_at) - new Date()) / 1000))
      setSecondsLeft(secs)
      if (secs === 0) setPairing(null)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [pairing])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await generatePairingCode({ childId, deviceName: deviceName.trim() || 'New device' })
      setPairing(result)
      setDeviceName('')
      await loadDevices()
    } catch (error) {
      toast.error('Could not generate pairing code', error.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleRemove = async (device) => {
    const ok = window.confirm(`Remove device "${device.device_name || 'Unnamed'}"? This cannot be undone.`)
    if (!ok) return
    try {
      await removeDevice(device.id)
      await loadDevices()
      toast.success('Device removed')
    } catch (error) {
      toast.error('Could not remove device', error.message)
    }
  }

  const copyCode = () => {
    if (!pairing) return
    navigator.clipboard?.writeText(pairing.pairing_code)
    toast.info('Code copied')
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="py-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700">Add a device</p>
          <p className="text-xs text-slate-500">
            Generate a pairing code, then open the VOICE Kids app on the child's device and enter it there.
          </p>
          <div className="flex gap-2">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Aarav's Phone"
              className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
            />
            <Button size="sm" icon={Plus} loading={generating} onClick={handleGenerate}>
              Generate code
            </Button>
          </div>

          {pairing && (
            <div className="mt-2 rounded-2xl bg-indigo-50 border border-indigo-100 p-4 text-center">
              <p className="text-3xl font-bold tracking-widest text-indigo-700 font-mono">
                {pairing.pairing_code}
              </p>
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 font-medium mt-2"
              >
                <Copy className="w-3.5 h-3.5" /> Copy code
              </button>
              <p className="flex items-center justify-center gap-1 text-xs text-slate-500 mt-2">
                <Clock className="w-3.5 h-3.5" />
                Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="space-y-2">
        {devices.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">No devices yet.</p>
        )}
        {devices.map((device) => {
          const meta = OWNER_MODE_META[device.device_owner_mode] ?? OWNER_MODE_META.none
          const Icon = meta.icon
          const online = isDeviceOnline(device)
          const child = { policy_version: device.policy_version }
          const syncState = derivePolicySyncState(device, child)
          const syncMeta = POLICY_SYNC_META[syncState]
          const isExpanded = expandedId === device.id
          const checklist = diagnosticChecklist(device, child)

          return (
            <Card key={device.id}>
              <CardBody className="py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-800 truncate">{device.device_name || 'Unnamed device'}</p>
                    <Badge variant={online ? 'tulasi' : 'default'} dot>
                      {online ? 'Online' : 'Offline'}
                    </Badge>
                    <Badge variant={syncMeta.tone}>{syncMeta.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={meta.variant}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </Badge>
                    {device.last_seen_at && (
                      <span className="text-xs text-slate-400">
                        Last seen {new Date(device.last_seen_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : device.id)}
                    className="flex items-center gap-1 text-xs text-indigo-600 font-medium mt-2"
                  >
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Diagnostics
                  </button>
                  {isExpanded && (
                    <div className="mt-2 rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                      <p className="text-xs text-slate-500 mb-1">{syncMeta.description}</p>
                      {checklist.map((row) => {
                        const RowIcon = row.ok === null ? HelpCircle : row.ok ? CheckCircle2 : XCircle
                        const color = row.ok === null ? 'text-slate-400' : row.ok ? 'text-green-600' : 'text-red-600'
                        return (
                          <div key={row.key} className="flex items-start gap-1.5 text-xs">
                            <RowIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
                            <span className="text-slate-600">{row.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {otherChildren.length > 0 && (
                  <div className="relative flex items-center" title="Reassign to another child">
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-300 pointer-events-none absolute left-2" />
                    <select
                      value=""
                      onChange={(e) => handleReassign(device, e.target.value)}
                      className="!w-auto !py-1.5 !pl-7 !pr-7 !text-xs !rounded-lg text-slate-500"
                    >
                      <option value="" disabled>Move to…</option>
                      {otherChildren.map((c) => (
                        <option key={c.id} value={c.id}>{c.display_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => handleRemove(device)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
