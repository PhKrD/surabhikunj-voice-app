import { useState, useEffect, useCallback } from 'react'
import {
  Building2, Users, X, Trash2, Plus,
  UtensilsCrossed, BookOpen, Sparkles, Heart, Home, Flower2, Sun,
  Music, Leaf, Wrench, Shield, Calendar, Bell, Star, Flame,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Card, { CardBody } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'

const DEPT_ICON_MAP = {
  Building2, Users, UtensilsCrossed, BookOpen, Sparkles, Heart, Home,
  Flower2, Sun, Music, Leaf, Wrench, Shield, Calendar, Bell, Star, Flame,
}

function memberLabel(m) {
  return m.display_name ?? m.spiritual_name ?? m.legal_name ?? m.email ?? 'Unnamed'
}

export default function DepartmentDetail({ department, orgId, canManage, onClose, onChanged }) {
  const toast = useToastStore()
  const [orgMembers, setOrgMembers] = useState([])
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [inchargeId, setInchargeId] = useState(department.incharge_id ?? '')
  const [subInchargeId, setSubInchargeId] = useState(department.sub_incharge_id ?? '')
  const [savingLeadership, setSavingLeadership] = useState(false)
  const [addSelectId, setAddSelectId] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  const loadOrgMembers = useCallback(async () => {
    if (!orgId) return
    const { data, error } = await supabase.rpc('org_members')
    if (!error && data) {
      setOrgMembers(data)
      return
    }

    const { data: fallback } = await supabase
      .from('profiles')
      .select('id, display_name, spiritual_name, email')
      .eq('org_id', orgId)

    setOrgMembers(fallback ?? [])
  }, [orgId])

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true)
    try {
      const { data, error } = await supabase
        .from('department_members')
        .select('id, profile_id, joined_at, profile:profile_id(display_name, spiritual_name, avatar_url)')
        .eq('department_id', department.id)
        .order('joined_at')

      if (error) throw error
      setMembers(data ?? [])
    } catch (error) {
      toast.error('Could not load members', error.message)
    } finally {
      setLoadingMembers(false)
    }
  }, [department.id, toast])

  useEffect(() => {
    loadOrgMembers()
    loadMembers()
  }, [loadOrgMembers, loadMembers])

  const saveLeadership = async () => {
    setSavingLeadership(true)
    try {
      const { error } = await supabase
        .from('departments')
        .update({
          incharge_id: inchargeId || null,
          sub_incharge_id: subInchargeId || null,
        })
        .eq('id', department.id)

      if (error) throw error
      toast.success('Leadership updated')
      onChanged?.()
    } catch (error) {
      toast.error('Could not update leadership', error.message)
    } finally {
      setSavingLeadership(false)
    }
  }

  const addMember = async () => {
    if (!addSelectId) return
    setAddingMember(true)
    try {
      const { error } = await supabase
        .from('department_members')
        .insert({ department_id: department.id, profile_id: addSelectId })

      if (error) throw error
      setAddSelectId('')
      await loadMembers()
      toast.success('Member added')
      onChanged?.()
    } catch (error) {
      toast.error('Could not add member', error.message)
    } finally {
      setAddingMember(false)
    }
  }

  const removeMember = async (member) => {
    const ok = window.confirm(`Remove "${memberLabel(member.profile ?? {})}" from this department?`)
    if (!ok) return

    setRemovingId(member.id)
    try {
      const { error } = await supabase
        .from('department_members')
        .delete()
        .eq('id', member.id)

      if (error) throw error
      await loadMembers()
      toast.success('Member removed')
      onChanged?.()
    } catch (error) {
      toast.error('Could not remove member', error.message)
    } finally {
      setRemovingId(null)
    }
  }

  const memberIds = new Set(members.map((m) => m.profile_id))
  const availableMembers = orgMembers.filter((m) => !memberIds.has(m.id))

  const LI = department.icon && DEPT_ICON_MAP[department.icon]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <CardBody className="py-5 space-y-5">
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                style={{ backgroundColor: department.color ? department.color + '20' : '#f9731620' }}
              >
                {LI
                  ? <LI className="w-5 h-5" style={{ color: department.color ?? '#f97316' }} />
                  : <span>{department.icon ?? '🏛️'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-primary-token truncate">{department.name}</p>
                {department.description && (
                  <p className="text-xs text-secondary-token mt-0.5">{department.description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-token hover:text-secondary-token hover:bg-[var(--surface-muted)] flex-shrink-0"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-secondary-token uppercase tracking-wide">Leadership</p>
              {canManage ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-secondary-token">Incharge</span>
                    <select
                      value={inchargeId}
                      onChange={(e) => setInchargeId(e.target.value)}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                    >
                      <option value="">— None —</option>
                      {orgMembers.map((m) => (
                        <option key={m.id} value={m.id}>{memberLabel(m)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-secondary-token">Sub-incharge</span>
                    <select
                      value={subInchargeId}
                      onChange={(e) => setSubInchargeId(e.target.value)}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                    >
                      <option value="">— None —</option>
                      {orgMembers.map((m) => (
                        <option key={m.id} value={m.id}>{memberLabel(m)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="sm:col-span-2">
                    <Button size="sm" onClick={saveLeadership} loading={savingLeadership}>
                      Save Leadership
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-1.5">
                    <Avatar
                      name={department.incharge?.spiritual_name}
                      url={department.incharge?.avatar_url}
                      size="sm"
                    />
                    <p className="text-xs text-secondary-token">
                      {department.incharge?.spiritual_name ?? 'No incharge'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Avatar
                      name={department.sub_incharge?.spiritual_name}
                      url={department.sub_incharge?.avatar_url}
                      size="sm"
                    />
                    <p className="text-xs text-secondary-token">
                      {department.sub_incharge?.spiritual_name ?? 'No sub-incharge'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-secondary-token uppercase tracking-wide">
                Members ({members.length})
              </p>

              {loadingMembers ? (
                <p className="text-xs text-muted-token py-2">Loading members...</p>
              ) : members.length === 0 ? (
                <p className="text-xs text-muted-token py-2">No members yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl hover:bg-[var(--surface-muted)]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar
                          name={m.profile?.spiritual_name ?? m.profile?.display_name}
                          url={m.profile?.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-primary-token truncate">{memberLabel(m.profile ?? {})}</p>
                          {m.joined_at && (
                            <p className="text-[11px] text-muted-token">
                              Joined {new Date(m.joined_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <button
                          onClick={() => removeMember(m)}
                          disabled={removingId === m.id}
                          className="p-1 rounded-md text-muted-token hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                          title="Remove member"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={addSelectId}
                    onChange={(e) => setAddSelectId(e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                  >
                    <option value="">Select a member to add...</option>
                    {availableMembers.map((m) => (
                      <option key={m.id} value={m.id}>{memberLabel(m)}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    icon={Plus}
                    onClick={addMember}
                    loading={addingMember}
                    disabled={!addSelectId}
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
