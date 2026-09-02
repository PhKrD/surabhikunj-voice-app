import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { GitBranch, Crown, Shield, Star, Users, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

const levelConfig = {
  vmc: { label: 'VMC', icon: Crown, color: 'bg-saffron-500 text-white', order: 0 },
  oc: { label: 'Office Committee', icon: Shield, color: 'bg-lotus-500 text-white', order: 1 },
  hod: { label: 'Head of Department', icon: Star, color: 'bg-tulasi-600 text-white', order: 2 },
  dept_leader: { label: 'Department Leader', icon: Users, color: 'bg-blue-500 text-white', order: 3 },
  counsellor: { label: 'Counsellors', icon: Users, color: 'bg-indigo-500 text-white', order: 4 },
  devotee: { label: 'Devotees', icon: Users, color: 'bg-slate-400 text-white', order: 5 },
}

const levelOptions = Object.entries(levelConfig)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([value, cfg]) => ({ value, label: cfg.label }))

const defaultForm = {
  title: '',
  level: 'devotee',
  profile_id: '',
  description: '',
  sort_order: 0,
}

const memberLabel = (m) => m.display_name || m.spiritual_name || m.legal_name || m.email || 'Unnamed'

export default function HierarchyPage() {
  const { profile } = useAuthStore()
  const { org, hasPermission } = useOrgStore()
  const toast = useToastStore()
  const orgId = org?.id ?? profile?.org_id
  const [positions, setPositions] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)
  const canManage = hasPermission('hierarchy.manage')

  const loadPositions = useCallback(async () => {
    if (!orgId) {
      setPositions([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('org_positions')
        .select('*, profile:profile_id(spiritual_name, avatar_url, role)')
        .eq('org_id', orgId)
        .order('sort_order')

      if (error) throw error
      setPositions(data ?? [])
    } catch (error) {
      toast.error('Could not load positions', error.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  const loadMembers = useCallback(async () => {
    if (!orgId) {
      setMembers([])
      return
    }

    const { data, error } = await supabase.rpc('org_members')
    if (!error && data) {
      setMembers(data)
      return
    }

    const { data: fallback } = await supabase
      .from('profiles')
      .select('id, display_name, spiritual_name, email')
      .eq('org_id', orgId)

    setMembers(fallback ?? [])
  }, [orgId])

  useEffect(() => {
    const id = setTimeout(() => {
      loadPositions()
      loadMembers()
    }, 0)
    return () => clearTimeout(id)
  }, [loadPositions, loadMembers])

  const resetForm = () => {
    setForm(defaultForm)
    setFormError('')
    setEditingId(null)
  }

  const createOrUpdatePosition = async () => {
    if (!orgId) return
    if (!form.title.trim()) {
      setFormError('Position title is required.')
      return
    }

    setFormError('')
    setSaving(true)
    try {
      const payload = {
        org_id: orgId,
        title: form.title.trim(),
        level: form.level,
        profile_id: form.profile_id || null,
        description: form.description.trim() || null,
        sort_order: Number(form.sort_order) || 0,
      }

      const query = editingId
        ? supabase.from('org_positions').update(payload).eq('id', editingId)
        : supabase.from('org_positions').insert(payload)

      const { error } = await query

      if (error) {
        setFormError(error.message)
        toast.error('Could not save position', error.message)
        return
      }

      resetForm()
      setShowForm(false)
      await loadPositions()
      toast.success(editingId ? 'Position updated' : 'Position created')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not save position', error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (pos) => {
    setEditingId(pos.id)
    setFormError('')
    setShowForm(true)
    setForm({
      title: pos.title ?? '',
      level: pos.level ?? 'devotee',
      profile_id: pos.profile_id ?? '',
      description: pos.description ?? '',
      sort_order: pos.sort_order ?? 0,
    })
  }

  const removePosition = async (pos) => {
    const ok = window.confirm(`Delete position "${pos.title}"?`)
    if (!ok) return

    setDeletingId(pos.id)
    try {
      const { error } = await supabase.from('org_positions').delete().eq('id', pos.id)

      if (error) {
        toast.error('Could not delete position', error.message)
        return
      }

      if (editingId === pos.id) {
        resetForm()
        setShowForm(false)
      }
      await loadPositions()
      toast.success('Position deleted')
    } catch (error) {
      toast.error('Could not delete position', error.message)
    } finally {
      setDeletingId(null)
    }
  }

  const grouped = Object.entries(levelConfig)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([level, cfg]) => ({
      level,
      cfg,
      items: positions.filter((p) => p.level === level),
    }))
    .filter((g) => g.items.length > 0)

  if (loading) return <div className="text-center py-12 text-muted-token text-sm">Loading...</div>

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-saffron-500" />
          <h2 className="text-lg font-bold text-primary-token">Organizational Structure</h2>
        </div>
        {canManage && (
          <Button
            size="sm"
            icon={showForm ? X : Plus}
            onClick={() => {
              if (showForm) resetForm()
              setShowForm((v) => !v)
            }}
          >
            {showForm ? 'Close' : 'Add Position'}
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <p className="text-sm font-semibold text-primary-token">
              {editingId ? 'Edit Position' : 'Create Position'}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Title</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Temple President"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Level</span>
                <select
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm bg-[var(--surface)]"
                >
                  {levelOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Assign Member</span>
                <select
                  value={form.profile_id}
                  onChange={(e) => setForm((f) => ({ ...f, profile_id: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm bg-[var(--surface)]"
                >
                  <option value="">— Vacant —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{memberLabel(m)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Sort Order</span>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-secondary-token">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm resize-none"
              />
            </label>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={createOrUpdatePosition} loading={saving}>
                {editingId ? 'Save Changes' : 'Create'}
              </Button>
              {editingId ? (
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
              ) : null}
            </div>
            {formError ? (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
            ) : null}
          </CardBody>
        </Card>
      )}

      {positions.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-muted-token">
              <GitBranch className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No hierarchy configured yet.</p>
              {canManage && !showForm && (
                <div className="mt-4">
                  <Button size="sm" icon={Plus} onClick={() => setShowForm(true)}>
                    Add Position
                  </Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="relative">
        {grouped.length > 1 && (
          <div className="absolute left-5 top-8 bottom-8 w-0.5 bg-gradient-to-b from-saffron-200 via-lotus-200 to-slate-200" />
        )}

        <div className="space-y-4">
          {grouped.map(({ level, cfg, items }, idx) => {
            const LevelIcon = cfg.icon
            return (
              <motion.div
                key={level}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm z-10 ${cfg.color}`}>
                    <LevelIcon className="w-5 h-5" />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs font-bold text-secondary-token uppercase tracking-wide">{cfg.label}</p>
                      <Badge variant="default">{items.length}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {items.map((pos) => (
                        <div
                          key={pos.id}
                          className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border-color)] rounded-xl px-3 py-2 shadow-sm"
                        >
                          {pos.profile ? (
                            <>
                              <Avatar
                                name={pos.profile.spiritual_name}
                                url={pos.profile.avatar_url}
                                size="sm"
                              />
                              <div>
                                <p className="text-sm font-semibold text-primary-token leading-tight">
                                  {pos.profile.spiritual_name}
                                </p>
                                <p className="text-xs text-muted-token">{pos.title}</p>
                              </div>
                            </>
                          ) : (
                            <div>
                              <p className="text-sm font-semibold text-secondary-token">{pos.title}</p>
                              <p className="text-xs text-muted-token italic">Vacant</p>
                            </div>
                          )}
                          {canManage ? (
                            <div className="flex items-center gap-1 pl-1">
                              <button
                                onClick={() => startEdit(pos)}
                                disabled={deletingId === pos.id}
                                className="p-1 rounded-md text-muted-token hover:text-saffron-600 hover:bg-saffron-50"
                                title="Edit position"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => removePosition(pos)}
                                disabled={deletingId === pos.id}
                                className="p-1 rounded-md text-muted-token hover:text-red-600 hover:bg-red-50"
                                title="Delete position"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
