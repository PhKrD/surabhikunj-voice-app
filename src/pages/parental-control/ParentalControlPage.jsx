import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, ChevronRight, Smartphone, ShieldCheck, BarChart3 } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import { listChildren, createChild } from '@/lib/parentalControlApi'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import DeviceModeSetupPage from './DeviceModeSetupPage'
import MemberLinkPicker from '@/components/parental-control/MemberLinkPicker'

const defaultForm = { displayName: '', dateOfBirth: '', ageGroup: 'child', linkedProfileId: null }

export default function ParentalControlPage() {
  const navigate = useNavigate()
  const { org } = useOrgStore()
  const toast = useToastStore()
  const deviceMode = useDeviceModeStore((s) => s.mode)

  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)

  const loadChildren = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listChildren()
      setChildren(data)
    } catch (error) {
      toast.error('Could not load children', error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const id = setTimeout(() => {
      loadChildren()
    }, 0)
    return () => clearTimeout(id)
  }, [loadChildren])

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
      await loadChildren()
      toast.success('Child added')
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

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading...</div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary-token">Parental Control ({children.length})</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={BarChart3}
            onClick={() => navigate('/parental-control/dashboard')}
          >
            Dashboard
          </Button>
          <Button
            size="sm"
            icon={showForm ? X : Plus}
            onClick={() => {
              if (showForm) resetForm()
              setShowForm((v) => !v)
            }}
          >
            {showForm ? 'Close' : 'Add Child'}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <p className="text-sm font-semibold text-primary-token">Add Child</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Name</span>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="Aarav"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Date of birth</span>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-secondary-token">Age group</span>
              <select
                value={form.ageGroup}
                onChange={(e) => setForm((f) => ({ ...f, ageGroup: e.target.value }))}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
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
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false) }}>
                Cancel
              </Button>
              <Button size="sm" loading={saving} onClick={handleCreate}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {children.length === 0 && !showForm && (
        <Card>
          <CardBody className="py-10 text-center">
            <ShieldCheck className="w-10 h-10 text-muted-token mx-auto mb-3" />
            <p className="text-sm text-secondary-token">No children added yet.</p>
            <p className="text-xs text-muted-token mt-1">Add a child to start managing their devices and screen time.</p>
          </CardBody>
        </Card>
      )}

      {deviceMode === 'parent' && (
        <button
          onClick={() => {
            if (window.confirm('Reconfigure this device? You will be asked "I am a Parent / I am a Child" again next time you open Parental Control.')) {
              useDeviceModeStore.getState().reset()
            }
          }}
          className="text-xs text-muted-token hover:text-secondary-token underline"
        >
          Reconfigure this device's Parental Control mode
        </button>
      )}

      <div className="space-y-2">
        {children.map((child) => {
          const devices = child.pc_devices ?? []
          const activeDevices = devices.filter((d) => d.is_active)
          return (
            <Card key={child.id} hover onClick={() => navigate(`/parental-control/${child.id}`)}>
              <CardBody className="py-4 flex items-center gap-3">
                <Avatar name={child.display_name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-primary-token truncate">{child.display_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {child.age_group && <Badge variant="default">{child.age_group}</Badge>}
                    <span className="flex items-center gap-1 text-xs text-muted-token">
                      <Smartphone className="w-3.5 h-3.5" />
                      {activeDevices.length} device{activeDevices.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-token flex-shrink-0" />
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
