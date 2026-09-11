import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import { createChild } from '@/lib/parentalControlApi'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import DeviceModeSetupPage from './DeviceModeSetupPage'
import MemberLinkPicker from '@/components/parental-control/MemberLinkPicker'
import ChildrenOverview from './ChildrenOverview'

/**
 * The parent console's single entry point: the family overview, plus the
 * "add a child" form. There used to be a second, near-identical
 * /parental-control/dashboard page listing the same children with
 * different stats — one screen now, and the route redirects here.
 */

const defaultForm = { displayName: '', dateOfBirth: '', ageGroup: 'child', linkedProfileId: null }

export default function ParentalControlPage() {
  const { org } = useOrgStore()
  const toast = useToastStore()
  const deviceMode = useDeviceModeStore((s) => s.mode)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)
  const [reloadKey, setReloadKey] = useState(0)

  const resetForm = () => {
    setForm(defaultForm)
    setFormError('')
  }

  const handleCreate = async () => {
    if (!form.displayName.trim()) {
      setFormError("Child's name is required.")
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await createChild({
        orgId: org?.id,
        displayName: form.displayName.trim(),
        dateOfBirth: form.dateOfBirth,
        ageGroup: form.ageGroup,
        linkedProfileId: form.linkedProfileId,
      })
      resetForm()
      setShowForm(false)
      setReloadKey((k) => k + 1)
      toast.success('Child added', 'Next: open them and pair a device.')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not add child', error.message)
    } finally {
      setSaving(false)
    }
  }

  // First time this device touches Parental Control: decide whether it
  // behaves as a parent console or hands off to the child pairing flow.
  // See src/store/deviceModeStore.js — this never creates a second app.
  if (deviceMode === 'unset') return <DeviceModeSetupPage />

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white px-6 pt-14 pb-8 rounded-b-[2rem]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-indigo-200 text-sm">Parental Control</p>
              <h1 className="text-2xl font-bold mt-0.5">Family</h1>
            </div>
            <Button
              size="sm"
              icon={showForm ? X : Plus}
              onClick={() => { if (showForm) resetForm(); setShowForm((v) => !v) }}
              className="bg-white/10 hover:bg-white/20 border-white/20 text-white"
            >
              {showForm ? 'Close' : 'Add child'}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {showForm && (
          <Card>
            <CardBody className="py-5 space-y-4">
              <p className="text-sm font-semibold text-primary-token">Add a child</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs text-secondary-token">Name</span>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="Aarav"
                    className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-[var(--border-color)] text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-secondary-token">Date of birth</span>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                    className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-[var(--border-color)] text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-secondary-token">Age group</span>
                <select
                  value={form.ageGroup}
                  onChange={(e) => setForm((f) => ({ ...f, ageGroup: e.target.value }))}
                  className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-[var(--border-color)] text-sm"
                >
                  <option value="toddler">Toddler</option>
                  <option value="child">Child</option>
                  <option value="preteen">Preteen</option>
                  <option value="teen">Teen</option>
                </select>
              </label>
              <MemberLinkPicker
                value={form.linkedProfileId}
                onChange={(id) => setForm((f) => ({ ...f, linkedProfileId: id }))}
              />
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false) }}>
                  Cancel
                </Button>
                <Button size="sm" loading={saving} onClick={handleCreate}>Save</Button>
              </div>
            </CardBody>
          </Card>
        )}

        <ChildrenOverview reloadKey={reloadKey} onAddChild={() => setShowForm(true)} />

        {deviceMode === 'parent' && (
          <button
            onClick={() => {
              if (window.confirm('Reconfigure this device? You will be asked "I am a Parent / I am a Child" again next time you open Parental Control.')) {
                useDeviceModeStore.getState().reset()
              }
            }}
            className="text-xs text-muted-token hover:text-secondary-token underline"
          >
            Reconfigure this device&apos;s Parental Control mode
          </button>
        )}
      </div>
    </div>
  )
}
