import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Building2, Users, Plus, ChevronRight, X, Pencil, Trash2,
  UtensilsCrossed, BookOpen, Sparkles, Heart, Home, Flower2, Sun,
  Music, Leaf, Wrench, Shield, Calendar, Bell, Star, Flame,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import { isAdmin } from '@/lib/utils'
import useToastStore from '@/store/toastStore'

// Curated map so departments can render a lucide icon by stored name WITHOUT
// pulling the entire icon set into the bundle. Unknown names (e.g. emojis)
// fall back to plain text.
const DEPT_ICON_MAP = {
  Building2, Users, UtensilsCrossed, BookOpen, Sparkles, Heart, Home,
  Flower2, Sun, Music, Leaf, Wrench, Shield, Calendar, Bell, Star, Flame,
}

const defaultForm = {
  name: '',
  description: '',
  icon: '🏛️',
  color: '#f97316',
}

export default function DepartmentsPage() {
  const { profile } = useAuthStore()
  const toast = useToastStore()
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)
  const admin = isAdmin(profile?.role)

  const loadDepartments = useCallback(async () => {
    if (!profile) {
      setDepartments([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('departments')
        .select(`
          *,
          incharge:incharge_id(spiritual_name, avatar_url),
          sub_incharge:sub_incharge_id(spiritual_name, avatar_url),
          department_members(count)
        `)
        .eq('voice_id', profile.voice_id)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      setDepartments(data ?? [])
    } catch (error) {
      toast.error('Could not load departments', error.message)
    } finally {
      setLoading(false)
    }
  }, [profile, toast])

  useEffect(() => {
    const id = setTimeout(() => {
      loadDepartments()
    }, 0)
    return () => clearTimeout(id)
  }, [loadDepartments])

  const resetForm = () => {
    setForm(defaultForm)
    setFormError('')
    setEditingId(null)
  }

  const createOrUpdateDepartment = async () => {
    if (!profile) return
    if (!form.name.trim()) {
      setFormError('Department name is required.')
      return
    }

    setFormError('')
    setSaving(true)
    try {
      const payload = {
        voice_id: profile.voice_id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        icon: form.icon.trim() || null,
        color: form.color || null,
      }

      const query = editingId
        ? supabase.from('departments').update(payload).eq('id', editingId)
        : supabase.from('departments').insert(payload)

      const { error } = await query

      if (error) {
        setFormError(error.message)
        toast.error('Could not save department', error.message)
        return
      }

      resetForm()
      setShowForm(false)
      await loadDepartments()
      toast.success(editingId ? 'Department updated' : 'Department created')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not save department', error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (dept) => {
    setEditingId(dept.id)
    setFormError('')
    setShowForm(true)
    setForm({
      name: dept.name ?? '',
      description: dept.description ?? '',
      icon: dept.icon ?? '🏛️',
      color: dept.color ?? '#f97316',
    })
  }

  const removeDepartment = async (dept) => {
    const ok = window.confirm(`Archive department "${dept.name}"?`)
    if (!ok) return

    setArchivingId(dept.id)
    try {
      const { error } = await supabase
        .from('departments')
        .update({ is_active: false })
        .eq('id', dept.id)

      if (error) {
        toast.error('Could not archive department', error.message)
        return
      }

      await loadDepartments()
      toast.success('Department archived', '', {
        actionLabel: 'Undo',
        action: async () => {
          const { error: restoreError } = await supabase
            .from('departments')
            .update({ is_active: true })
            .eq('id', dept.id)

          if (restoreError) {
            toast.error('Could not restore department', restoreError.message)
            return
          }

          await loadDepartments()
          toast.info('Department restored')
        },
      })
    } catch (error) {
      toast.error('Could not archive department', error.message)
    } finally {
      setArchivingId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Departments ({departments.length})</h2>
        {admin && (
          <Button
            size="sm"
            icon={showForm ? X : Plus}
            onClick={() => {
              if (showForm) resetForm()
              setShowForm((v) => !v)
            }}
          >
            {showForm ? 'Close' : 'Add Department'}
          </Button>
        )}
      </div>

      {admin && showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">
              {editingId ? 'Edit Department' : 'Create Department'}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Kitchen"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Icon (emoji/text)</span>
                <input
                  value={form.icon}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="🍲"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-slate-500">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none"
              />
            </label>
            <div className="flex items-center gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Color</span>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="w-14 h-10 mt-1 p-1 rounded-xl border border-slate-200"
                />
              </label>
              <div className="pt-5">
                <Button size="sm" onClick={createOrUpdateDepartment} loading={saving}>
                  {editingId ? 'Save Changes' : 'Create'}
                </Button>
              </div>
              {editingId ? (
                <div className="pt-5">
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
                </div>
              ) : null}
            </div>
            {formError ? (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
            ) : null}
          </CardBody>
        </Card>
      )}

      {departments.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <Building2 className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No departments created yet.</p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {departments.map((dept) => (
          <motion.div key={dept.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="hover:shadow-md transition-shadow duration-200 cursor-pointer group">
              <CardBody className="py-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                    style={{ backgroundColor: dept.color ? dept.color + '20' : '#f97316' + '20' }}
                  >
                    {(() => {
                      const LI = dept.icon && DEPT_ICON_MAP[dept.icon]
                      return LI
                        ? <LI className="w-5 h-5" style={{ color: dept.color ?? '#f97316' }} />
                        : <span>{dept.icon ?? '🏛️'}</span>
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800 truncate">{dept.name}</p>
                      <div className="flex items-center gap-1">
                        {admin ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                startEdit(dept)
                              }}
                              disabled={archivingId === dept.id}
                              className="p-1 rounded-md text-slate-400 hover:text-saffron-600 hover:bg-saffron-50"
                              title="Edit department"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                removeDepartment(dept)
                              }}
                              disabled={archivingId === dept.id}
                              className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Archive department"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : null}
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 transition-colors" />
                      </div>
                    </div>
                    {dept.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{dept.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {dept.incharge && (
                        <div className="flex items-center gap-1.5">
                          <Avatar name={dept.incharge.spiritual_name} url={dept.incharge.avatar_url} size="sm" />
                          <p className="text-xs text-slate-600 truncate max-w-28">{dept.incharge.spiritual_name}</p>
                        </div>
                      )}
                      <Badge variant="default">
                        <Users className="w-3 h-3 mr-1" />
                        {dept.department_members?.[0]?.count ?? 0}
                      </Badge>
                    </div>
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
