import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Clock, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listDevices, generatePairingCode, removeDevice } from '@/lib/parentalControlApi'

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

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      setDevices(await listDevices(childId))
    } catch (error) {
      toast.error('Could not load devices', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

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
          return (
            <Card key={device.id}>
              <CardBody className="py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{device.device_name || 'Unnamed device'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={meta.variant}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </Badge>
                    {device.last_seen_at && (
                      <span className="text-xs text-slate-400">
                        Last seen {new Date(device.last_seen_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
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
