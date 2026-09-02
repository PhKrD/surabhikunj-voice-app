import { useState, useEffect, useCallback } from 'react'
import { UtensilsCrossed, ChevronLeft, ChevronRight, Plus, Trash2, X, Star } from 'lucide-react'
import { format, addDays, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useOrgStore from '@/store/orgStore'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Can from '@/components/Can'
import { useTerm } from '@/hooks/usePermission'
import useToastStore from '@/store/toastStore'

// ── Plan edit modal ───────────────────────────────────────────────────────────
function PlanModal({ type, slot, plan, dateStr, orgId, onClose, onSaved }) {
  const toast = useToastStore()
  const [items, setItems]       = useState((plan?.resource_plan_items ?? []).map((i) => ({ ...i })))
  const [notes, setNotes]       = useState(plan?.notes ?? '')
  const [isSpecial, setIsSpecial] = useState(plan?.is_special ?? false)
  const [saving, setSaving]     = useState(false)
  const [newItem, setNewItem]   = useState('')
  const [newQty, setNewQty]     = useState('')

  const addItem = () => {
    if (!newItem.trim()) return
    setItems((prev) => [...prev, { id: null, name: newItem.trim(), quantity: newQty.trim() || null, sort_order: prev.length }])
    setNewItem('')
    setNewQty('')
  }

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const save = async () => {
    setSaving(true)
    try {
      let planId = plan?.id
      if (!planId) {
        const { data, error } = await supabase
          .from('resource_plans')
          .insert({ resource_type_id: type.id, org_id: orgId, plan_date: dateStr, slot, notes, is_special: isSpecial })
          .select('id')
          .single()
        if (error) throw error
        planId = data.id
      } else {
        const { error } = await supabase
          .from('resource_plans')
          .update({ notes, is_special: isSpecial })
          .eq('id', planId)
        if (error) throw error
        await supabase.from('resource_plan_items').delete().eq('plan_id', planId)
      }
      if (items.length) {
        const { error } = await supabase.from('resource_plan_items').insert(
          items.map((it, i) => ({ plan_id: planId, name: it.name, quantity: it.quantity ?? null, sort_order: i }))
        )
        if (error) throw error
      }
      toast.success('Plan saved')
      onSaved()
    } catch (e) {
      toast.error('Save failed', e.message)
    } finally {
      setSaving(false)
    }
  }

  const deletePlan = async () => {
    if (!plan?.id || !confirm('Delete this plan?')) return
    setSaving(true)
    const { error } = await supabase.from('resource_plans').delete().eq('id', plan.id)
    if (error) toast.error('Delete failed', error.message)
    else { toast.success('Plan deleted'); onSaved() }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-color)]">
          <div>
            <p className="font-bold text-primary-token">{type.name} — {slot}</p>
            <p className="text-sm text-secondary-token">{format(new Date(dateStr), 'EEE, dd MMM yyyy')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--surface-muted)]">
            <X className="w-5 h-5 text-secondary-token" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Special toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`w-10 h-6 rounded-full transition-colors ${isSpecial ? 'bg-amber-400' : 'bg-slate-200'}`}
              onClick={() => setIsSpecial((v) => !v)}
            >
              <div className={`w-5 h-5 bg-[var(--surface)] rounded-full shadow mt-0.5 transition-transform ${isSpecial ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm font-medium text-primary-token flex items-center gap-1">
              <Star className="w-4 h-4 text-amber-400" /> Special / Festival
            </span>
          </label>

          {/* Items */}
          <div>
            <p className="text-sm font-semibold text-primary-token mb-2">Items</p>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-primary-token bg-[var(--surface-muted)] rounded-xl px-3 py-2">{item.name}</span>
                  {item.quantity && <span className="text-xs text-muted-token whitespace-nowrap">{item.quantity}</span>}
                  <button onClick={() => removeItem(idx)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="Add item…"
                className="flex-1 text-sm border border-[var(--border-color)] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-saffron-400"
              />
              <input
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="Qty"
                className="w-20 text-sm border border-[var(--border-color)] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-saffron-400"
              />
              <button onClick={addItem} className="px-3 py-2 bg-saffron-100 text-saffron-700 rounded-xl hover:bg-saffron-200">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-sm font-semibold text-primary-token mb-1">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes (e.g. Ekadashi fasting menu)…"
              className="w-full text-sm border border-[var(--border-color)] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-saffron-400 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-[var(--border-color)]">
          {plan?.id && (
            <button onClick={deletePlan} disabled={saving} className="p-2 text-red-400 hover:bg-red-50 rounded-xl">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save Plan</Button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ResourcesPage() {
  const label = useTerm('resources', 'Resource Plans')
  const { org } = useOrgStore()
  const [date, setDate]         = useState(new Date())
  const [types, setTypes]       = useState([])
  const [plans, setPlans]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null) // { type, slot, plan }

  const dateStr = format(date, 'yyyy-MM-dd')

  useEffect(() => {
    supabase
      .from('resource_types')
      .select('id, name, icon, color, slots')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setTypes(data ?? []))
  }, [])

  const loadPlans = useCallback(() => {
    if (!types.length) return
    setLoading(true)
    supabase
      .from('resource_plans')
      .select('id, resource_type_id, slot, title, notes, is_special, resource_plan_items(id, name, quantity, sort_order)')
      .eq('plan_date', dateStr)
      .order('slot')
      .then(({ data }) => { setPlans(data ?? []); setLoading(false) })
  }, [dateStr, types.length])

  useEffect(() => { loadPlans() }, [loadPlans])

  const plansByType = types.map((t) => ({
    ...t,
    plans: plans.filter((p) => p.resource_type_id === t.id),
  }))

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-primary-token">{label}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate((d) => subDays(d, 1))} className="p-2 rounded-xl text-secondary-token hover:bg-[var(--surface-muted)]">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-primary-token min-w-[110px] text-center">
            {format(date, 'EEE, MMM d')}
          </span>
          <button onClick={() => setDate((d) => addDays(d, 1))} className="p-2 rounded-xl text-secondary-token hover:bg-[var(--surface-muted)]">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {loading && <div className="text-center text-muted-token py-12">Loading plans…</div>}

      {!loading && plansByType.map((type) => (
        <div key={type.id} className="space-y-3">
          <h2 className="text-base font-bold text-primary-token">{type.name}</h2>
          {(type.slots ?? []).map((slot) => {
            const plan = type.plans.find((p) => p.slot === slot)
            return (
              <Card key={slot} className="border-l-4" style={{ borderLeftColor: type.color ?? '#f59e0b' }}>
                <CardBody>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-primary-token">{slot}</span>
                      {plan?.is_special && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Star className="w-3 h-3" /> Special
                        </span>
                      )}
                    </div>
                    <Can permission="resources.manage">
                      <button
                        onClick={() => setModal({ type, slot, plan: plan ?? null })}
                        className="text-xs text-saffron-600 hover:text-saffron-700 font-medium px-2 py-1 rounded-lg hover:bg-saffron-50"
                      >
                        {plan ? 'Edit' : '+ Add'}
                      </button>
                    </Can>
                  </div>

                  {plan ? (
                    <ul className="space-y-1">
                      {(plan.resource_plan_items ?? [])
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((item) => (
                          <li key={item.id} className="flex items-center gap-2 text-sm text-secondary-token">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                            {item.name}
                            {item.quantity && <span className="text-muted-token">({item.quantity})</span>}
                          </li>
                        ))}
                      {plan.notes && <p className="text-xs text-muted-token mt-1 italic">{plan.notes}</p>}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-token italic">Not planned yet</p>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      ))}

      {!loading && plansByType.length === 0 && (
        <Card>
          <CardBody className="py-12 text-center text-muted-token">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No resource types configured yet.</p>
          </CardBody>
        </Card>
      )}

      {modal && (
        <PlanModal
          type={modal.type}
          slot={modal.slot}
          plan={modal.plan}
          dateStr={dateStr}
          orgId={org?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadPlans() }}
        />
      )}
    </div>
  )
}
