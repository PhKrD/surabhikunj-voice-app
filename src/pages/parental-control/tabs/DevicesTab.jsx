import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Clock, ShieldCheck, ShieldAlert, ShieldOff, ArrowLeftRight, ChevronDown, ChevronUp, CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { listDevices, generatePairingCode, removeDevice, reassignDevice, listChildren, getChild, updateChild } from '@/lib/parentalControlApi'
import { isDeviceOnline } from '@/lib/commandStatus'
import { derivePolicySyncState, POLICY_SYNC_META, diagnosticChecklist } from '@/lib/policySync'
import ProtectionPinCard from '@/components/parental-control/ProtectionPinCard'
import MemberLinkPicker from '@/components/parental-control/MemberLinkPicker'

const OWNER_MODE_META = {
  device_owner: { label: 'Advanced mode (Device Owner)', icon: ShieldCheck, variant: 'tulasi' },
  device_admin: { label: 'Protected (Device Admin)', icon: ShieldCheck, variant: 'tulasi' },
  none: { label: 'Setup needed', icon: ShieldOff, variant: 'yellow' },
}

/**
 * Real protection badge from what the device itself last reported. A device
 * that has never reported falls back to device_owner_mode (which migration 70
 * now keeps in sync with the report anyway).
 */
function protectionMeta(device) {
  const s = device.enforcement_state
  if (!s) return OWNER_MODE_META[device.device_owner_mode] ?? OWNER_MODE_META.none
  const missing = [
    s.device_admin === false && 'Device Admin',
    s.accessibility_enabled === false && 'Accessibility',
    s.usage_access === false && 'Usage access',
  ].filter(Boolean)
  if (missing.length === 0) return s.device_owner ? OWNER_MODE_META.device_owner : OWNER_MODE_META.device_admin
  return { label: `Setup incomplete: ${missing.join(', ')}`, icon: ShieldAlert, variant: 'yellow' }
}

export default function DevicesTab({ childId, onChildUpdated }) {
  const toast = useToastStore()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [deviceName, setDeviceName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [pairing, setPairing] = useState(null) // { pairing_code, expires_at }
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [otherChildren, setOtherChildren] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [child, setChild] = useState(null)

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const [devs, children, childRow] = await Promise.all([listDevices(childId), listChildren(), getChild(childId)])
      setDevices(devs)
      setOtherChildren(children.filter((c) => c.id !== childId))
      setChild(childRow)
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

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-5">
      {child && (
        <ProtectionPinCard
          child={child}
          onUpdated={(updated) => { setChild(updated); onChildUpdated?.(updated) }}
        />
      )}

      <Card>
        <CardBody className="py-5 space-y-4">
          <p className="text-sm font-semibold text-primary-token">Add a device</p>
          <p className="text-sm text-secondary-token">
            Generate a pairing code, then open the VOICE Kids app on the child's device and enter it there.
          </p>
          <div className="flex gap-3">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Aarav's Phone"
              className="flex-1 px-4 py-3 rounded-2xl border border-[var(--border-color)] text-sm"
            />
            <Button size="sm" icon={Plus} loading={generating} onClick={handleGenerate}>
              Generate code
            </Button>
          </div>

          {pairing && (
            <div className="mt-3 rounded-3xl bg-indigo-50 border border-indigo-100 p-5 text-center">
              <p className="text-4xl font-bold tracking-widest text-indigo-700 font-mono">
                {pairing.pairing_code}
              </p>
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 font-medium mt-3"
              >
                <Copy className="w-4 h-4" /> Copy code
              </button>
              <p className="flex items-center justify-center gap-1.5 text-sm text-secondary-token mt-3">
                <Clock className="w-4 h-4" />
                Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        {devices.length === 0 && (
          <p className="text-sm text-muted-token text-center py-8">No devices yet.</p>
        )}
        {devices.map((device) => {
          const meta = protectionMeta(device)
          const Icon = meta.icon
          const online = isDeviceOnline(device)
          // The child row carries policy_version + parent_pin_hash for the
          // diagnostics; `device.policy_version` is the joined copy and is
          // the fallback while the child row is still loading.
          const childForSync = { ...(child ?? {}), policy_version: child?.policy_version ?? device.policy_version }
          const syncState = derivePolicySyncState(device, childForSync)
          const syncMeta = POLICY_SYNC_META[syncState]
          const isExpanded = expandedId === device.id
          const checklist = diagnosticChecklist(device, childForSync)

          return (
            <Card key={device.id}>
              <CardBody className="py-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-primary-token truncate">{device.device_name || 'Unnamed device'}</p>
                    <Badge variant={online ? 'tulasi' : 'default'} dot>
                      {online ? 'Online' : 'Offline'}
                    </Badge>
                    <Badge variant={syncMeta.tone}>{syncMeta.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant={meta.variant}>
                      <Icon className="w-3.5 h-3.5" /> {meta.label}
                    </Badge>
                    {device.last_seen_at && (
                      <span className="text-sm text-muted-token">
                        Last seen {new Date(device.last_seen_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : device.id)}
                    className="flex items-center gap-1.5 text-sm text-indigo-600 font-medium mt-3"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    Diagnostics
                  </button>
                  {isExpanded && (
                    <div className="mt-3 rounded-2xl bg-[var(--surface-muted)] border border-[var(--border-color)] p-4 space-y-2">
                      <p className="text-sm text-secondary-token mb-2">{syncMeta.description}</p>
                      {checklist.map((row) => {
                        const RowIcon = row.ok === null ? HelpCircle : row.ok ? CheckCircle2 : XCircle
                        const color = row.ok === null ? 'text-muted-token' : row.ok ? 'text-green-600' : 'text-red-600'
                        return (
                          <div key={row.key} className="flex items-start gap-2 text-sm">
                            <RowIcon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                            <span className="text-secondary-token">{row.label}</span>
                          </div>
                        )
                      })}
                      {checklist.some((row) => row.key === 'device_admin' && row.ok === false) && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-2">
                          <p className="text-sm font-semibold text-secondary-token">
                            Screen lock and internet-pause will NOT work until this is fixed —
                            no computer or factory reset needed:
                          </p>
                          <ol className="text-sm text-secondary-token list-decimal list-inside space-y-1">
                            <li>Open VOICE on the child's device.</li>
                            <li>On the home screen, tap "Activate device admin" in the setup checklist and confirm.</li>
                          </ol>
                        </div>
                      )}
                      {checklist.some((row) => row.key === 'accessibility_enabled' && row.ok === false) && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-2">
                          <p className="text-sm font-semibold text-secondary-token">
                            App blocking, schedules and web/search monitoring will NOT work until this is fixed:
                          </p>
                          <ol className="text-sm text-secondary-token list-decimal list-inside space-y-1">
                            <li>Open VOICE on the child's device.</li>
                            <li>Tap "Enable Accessibility for VOICE" in the setup checklist, then turn it on for VOICE.</li>
                          </ol>
                        </div>
                      )}
                      {checklist.some((row) => row.key === 'usage_access' && row.ok === false) && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-2">
                          <p className="text-sm font-semibold text-secondary-token">
                            Daily limits and per-app time limits will NOT work until this is fixed:
                          </p>
                          <ol className="text-sm text-secondary-token list-decimal list-inside space-y-1">
                            <li>Open VOICE on the child's device.</li>
                            <li>Tap "Allow Usage access" in the setup checklist, find VOICE in the list and turn it on.</li>
                            <li>Or manually: Settings → Apps → Special app access → Usage access → VOICE → Allow.</li>
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {otherChildren.length > 0 && (
                  <div className="relative flex items-center" title="Reassign to another child">
                    <ArrowLeftRight className="w-4 h-4 text-muted-token pointer-events-none absolute left-2" />
                    <select
                      value=""
                      onChange={(e) => handleReassign(device, e.target.value)}
                      className="!w-auto !py-2 !pl-8 !pr-8 !text-sm !rounded-xl text-secondary-token"
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
                  className="p-2.5 rounded-xl text-muted-token hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </CardBody>
            </Card>
          )
        })}
      </div>

      {child && (
        <Card>
          <CardBody className="py-5 space-y-3">
            <p className="text-sm font-semibold text-primary-token">Link to a VOICE member</p>
            <p className="text-sm text-secondary-token">
              Optional. Linking lets this child use the full VOICE app (Sadhana, seva, …) on the same
              supervised device. Only affects the NEXT device paired for this child — already-paired
              devices keep the session they have.
            </p>
            <MemberLinkPicker
              value={child.linked_profile_id}
              onChange={async (profileId) => {
                try {
                  const updated = await updateChild(childId, { linked_profile_id: profileId })
                  setChild(updated)
                  onChildUpdated?.(updated)
                  toast.success(profileId ? 'Linked to VOICE member' : 'Unlinked — device-only again')
                } catch (error) {
                  toast.error('Could not update link', error.message)
                }
              }}
            />
          </CardBody>
        </Card>
      )}
    </div>
  )
}
