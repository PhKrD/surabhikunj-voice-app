/**
 * ProtectionPinCard.jsx
 *
 * Sets the parent PIN that guards the child device's Settings screens.
 *
 * Be honest in the copy: Android does not let any ordinary app FORBID
 * turning Accessibility, Device Admin, VPN or Usage access off — only a
 * Device Owner (factory-reset provisioning) can. With a PIN set, the
 * child's device notices those screens opening, leaves them immediately
 * and demands the PIN, and tells the parent. That's a strong deterrent,
 * not an OS-level lock. See android/.../dpc/SettingsGuard.kt and
 * PLATFORM_LIMITATIONS.md.
 */

import { useState } from 'react'
import { KeyRound, ShieldCheck, ShieldAlert, Check } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { updateChild } from '@/lib/parentalControlApi'
import { hashPin, isValidPin } from '@/lib/parentPin'

export default function ProtectionPinCard({ child, onUpdated }) {
  const toast = useToastStore()
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const hasPin = !!child?.parent_pin_hash
  const protectOn = child?.protect_settings !== false

  const save = async () => {
    if (!isValidPin(pin)) {
      toast.error('PIN must be 4 to 6 digits')
      return
    }
    if (pin !== confirmPin) {
      toast.error('The two PINs do not match')
      return
    }
    setSaving(true)
    try {
      const parent_pin_hash = await hashPin(pin, child.id)
      const updated = await updateChild(child.id, { parent_pin_hash, protect_settings: true })
      onUpdated?.(updated)
      setPin(''); setConfirmPin(''); setEditing(false)
      toast.success('Protection PIN set', 'The child device applies it within a minute.')
    } catch (error) {
      toast.error('Could not save PIN', error.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove the protection PIN? The child will be able to open those Settings screens freely again.')) return
    setSaving(true)
    try {
      const updated = await updateChild(child.id, { parent_pin_hash: null })
      onUpdated?.(updated)
      toast.info('Protection PIN removed')
    } catch (error) {
      toast.error('Could not remove PIN', error.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleProtect = async () => {
    try {
      const updated = await updateChild(child.id, { protect_settings: !protectOn })
      onUpdated?.(updated)
    } catch (error) {
      toast.error('Could not update', error.message)
    }
  }

  return (
    <Card>
      <CardBody className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hasPin ? 'bg-emerald-100' : 'bg-amber-100'}`}>
            {hasPin ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldAlert className="w-5 h-5 text-amber-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary-token">Protection PIN</p>
            <p className="text-xs text-secondary-token mt-0.5 leading-relaxed">
              {hasPin
                ? 'Set. If your child opens a Settings screen that could turn VOICE off, the device closes it and asks for this PIN — and you get an alert.'
                : 'Not set. Without it, your child can turn off Accessibility, Device Admin, VPN or Usage access from Settings and supervision stops.'}
            </p>
          </div>
          {hasPin && !editing && (
            <button onClick={toggleProtect} className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${protectOn ? 'bg-indigo-600' : 'bg-gray-300'}`} title="Guard settings screens">
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${protectOn ? 'translate-x-5' : ''}`} />
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="New PIN"
                className="px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm tracking-widest text-center"
              />
              <input
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="Confirm"
                className="px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm tracking-widest text-center"
              />
            </div>
            <p className="text-xs text-muted-token">
              4–6 digits. Don&apos;t use one your child already knows — and note a determined child can
              still bypass this by booting to safe mode.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setPin(''); setConfirmPin('') }}>Cancel</Button>
              <Button size="sm" icon={Check} loading={saving} onClick={save}>Save PIN</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" icon={KeyRound} variant={hasPin ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>
              {hasPin ? 'Change PIN' : 'Set a PIN'}
            </Button>
            {hasPin && (
              <Button size="sm" variant="secondary" loading={saving} onClick={remove}>Remove</Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
