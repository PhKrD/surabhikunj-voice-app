import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'

const INPUT_CLASS = 'w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'

const emptyForm = { name: '', location: '', description: '' }

export default function AreasManager({ orgId, canManage }) {
  const toast = useToastStore()
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    if (!orgId) {
      setAreas([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error: loadError } = await supabase
        .from('task_areas')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (loadError) throw loadError
      setAreas(data ?? [])
    } catch (e) {
      toast.error('Could not load areas', e.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setForm(emptyForm)
    setError('')
    setEditingId(null)
  }

  const save = async () => {
    if (!orgId) return
    if (!form.name.trim()) {
      setError('Area name is required.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const payload = {
        org_id: orgId,
        name: form.name.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      }
      const query = editingId
        ? supabase.from('task_areas').update(payload).eq('id', editingId)
        : supabase.from('task_areas').insert({ ...payload, is_active: true })
      const { error: saveError } = await query
      if (saveError) {
        setError(saveError.message)
        toast.error('Could not save area', saveError.message)
        return
      }
      resetForm()
      setShowForm(false)
      await load()
      toast.success(editingId ? 'Area updated' : 'Area created')
    } catch (e) {
      setError(e.message)
      toast.error('Could not save area', e.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (area) => {
    setEditingId(area.id)
    setError('')
    setShowForm(true)
    setForm({
      name: area.name ?? '',
      location: area.location ?? '',
      description: area.description ?? '',
    })
  }

  const remove = async (area) => {
    const ok = window.confirm(`Remove cleaning area "${area.name}"?`)
    if (!ok) return
    setBusyId(area.id)
    try {
      const { error: delError } = await supabase
        .from('task_areas')
        .update({ is_active: false })
        .eq('id', area.id)
      if (delError) {
        toast.error('Could not remove area', delError.message)
        return
      }
      await load()
      toast.success('Area removed', '', {
        actionLabel: 'Undo',
        action: async () => {
          const { error: restoreError } = await supabase
            .from('task_areas')
            .update({ is_active: true })
            .eq('id', area.id)
          if (restoreError) {
            toast.error('Could not restore area', restoreError.message)
            return
          }
          await load()
          toast.info('Area restored')
        },
      })
    } catch (e) {
      toast.error('Could not remove area', e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading areas…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Cleaning areas ({areas.length})</p>
        {canManage && (
          <Button
            size="sm"
            icon={showForm ? X : Plus}
            onClick={() => {
              if (showForm) resetForm()
              setShowForm((v) => !v)
            }}
          >
            {showForm ? 'Close' : 'Add Area'}
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">{editingId ? 'Edit Area' : 'New Area'}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Temple hall"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Location</span>
                <input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Ground floor"
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-slate-500">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={`${INPUT_CLASS} resize-none`}
              />
            </label>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={save} loading={saving}>
                {editingId ? 'Save Changes' : 'Create'}
              </Button>
              {editingId && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    resetForm()
                    setShowForm(false)
                  }}
                >
                  Cancel Edit
                </Button>
              )}
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}
          </CardBody>
        </Card>
      )}

      {areas.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <MapPin className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No cleaning areas yet.</p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {areas.map((area) => (
          <motion.div key={area.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardBody className="py-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-tulasi-100">
                    <MapPin className="w-5 h-5 text-tulasi-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800 truncate">{area.name}</p>
                      {canManage && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => startEdit(area)}
                            disabled={busyId === area.id}
                            className="p-1 rounded-md text-slate-400 hover:text-saffron-600 hover:bg-saffron-50"
                            title="Edit area"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => remove(area)}
                            disabled={busyId === area.id}
                            className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title="Remove area"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {area.location && <p className="text-xs text-slate-500 mt-0.5">{area.location}</p>}
                    {area.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{area.description}</p>}
                  </div>
                </div>
              </CardBody>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
