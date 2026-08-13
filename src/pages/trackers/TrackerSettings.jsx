import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft, Plus, Trash2, ChevronUp, ChevronDown, Layers, Sigma,
  MessageSquare, FlaskConical, Settings as SettingsIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import { calculateEntryScore } from '@/lib/trackerScoring'
import { FALLBACK_TEMPLATE } from '@/lib/trackerWhatsapp'
import { fetchTrackerConfig } from '@/lib/trackerApi'

const inputBase = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition'
const FIELD_TYPES = ['number', 'time', 'duration_min', 'boolean', 'select', 'text', 'textarea']
const RULE_TYPES = ['boolean', 'threshold', 'range', 'penalty', 'formula']
const TABS = [
  { key: 'fields', label: 'Fields & Groups', icon: Layers },
  { key: 'calculated', label: 'Calculated Columns', icon: Sigma },
  { key: 'whatsapp', label: 'WhatsApp Template', icon: MessageSquare },
  { key: 'preview', label: 'Preview', icon: FlaskConical },
]

function slugify(label) {
  return String(label ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function reindex(list) {
  return list.map((item, i) => ({ ...item, sort_order: (i + 1) * 10 }))
}

// ---------------------------------------------------------------------------
// Groups panel
// ---------------------------------------------------------------------------
function GroupsPanel({ groups, onChange, toast, trackerId }) {
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const addGroup = async () => {
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      const key = slugify(newLabel) || `group_${Date.now()}`
      const { data, error } = await supabase.from('tracker_field_groups').insert({
        tracker_id: trackerId, key, label: newLabel.trim(), sort_order: (groups.length + 1) * 10,
      }).select().single()
      if (error) throw error
      onChange([...groups, data])
      setNewLabel('')
    } catch (e) { toast.error('Could not add group', e.message) } finally { setSaving(false) }
  }

  const renameGroup = async (g, label) => {
    onChange(groups.map((x) => (x.id === g.id ? { ...x, label } : x)))
    await supabase.from('tracker_field_groups').update({ label }).eq('id', g.id)
  }

  const moveGroup = async (index, dir) => {
    const next = [...groups]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const reindexed = reindex(next)
    onChange(reindexed)
    await Promise.all(reindexed.map((g) => supabase.from('tracker_field_groups').update({ sort_order: g.sort_order }).eq('id', g.id)))
  }

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete group "${g.label}"? Fields in it become ungrouped.`)) return
    try {
      const { error } = await supabase.from('tracker_field_groups').delete().eq('id', g.id)
      if (error) throw error
      onChange(groups.filter((x) => x.id !== g.id))
      toast.success('Group deleted')
    } catch (e) { toast.error('Could not delete group', e.message) }
  }

  return (
    <Card>
      <CardHeader><p className="text-sm font-bold text-slate-800">Groups</p></CardHeader>
      <CardBody className="space-y-2">
        {groups.map((g, i) => (
          <div key={g.id} className="flex items-center gap-2 p-2 rounded-xl bg-slate-50">
            <div className="flex flex-col">
              <button onClick={() => moveGroup(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-600 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => moveGroup(i, 1)} disabled={i === groups.length - 1} className="text-slate-400 hover:text-slate-600 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
            </div>
            <input
              defaultValue={g.label}
              onBlur={(e) => e.target.value !== g.label && renameGroup(g, e.target.value)}
              className={cn(inputBase, 'flex-1 !py-1.5')}
            />
            <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 bg-white rounded">{g.key}</span>
            <button onClick={() => deleteGroup(g)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New group name, e.g. Service"
            className={cn(inputBase, 'flex-1')}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGroup())}
          />
          <Button size="sm" icon={Plus} onClick={addGroup} loading={saving}>Add</Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Rule editor — inline, per field
// ---------------------------------------------------------------------------
function RuleEditor({ rule, onSave, onDelete }) {
  const [draft, setDraft] = useState(rule)
  const cfg = draft.config ?? {}
  const setCfg = (patch) => setDraft((d) => ({ ...d, config: { ...(d.config ?? {}), ...patch } }))

  useEffect(() => { setDraft(rule) }, [rule])

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-white">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-slate-400">Rule Type</span>
          <select value={draft.rule_type} onChange={(e) => setDraft((d) => ({ ...d, rule_type: e.target.value, config: {} }))} className={cn(inputBase, '!py-1.5 mt-0.5')}>
            {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-400">Max Points</span>
          <input type="number" value={draft.max_points} onChange={(e) => setDraft((d) => ({ ...d, max_points: e.target.value }))} className={cn(inputBase, '!py-1.5 mt-0.5')} />
        </label>
      </div>

      {draft.rule_type === 'range' && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[11px] text-slate-400">Min</span>
            <input type="number" value={cfg.min ?? 0} onChange={(e) => setCfg({ min: Number(e.target.value) })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Target</span>
            <input type="number" value={cfg.full_score_at ?? ''} onChange={(e) => setCfg({ full_score_at: Number(e.target.value) })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
          </label>
          <label className="flex items-center gap-1.5 mt-5">
            <input type="checkbox" checked={cfg.allow_partial !== false} onChange={(e) => setCfg({ allow_partial: e.target.checked })} />
            <span className="text-[11px] text-slate-500">Partial scoring</span>
          </label>
        </div>
      )}

      {draft.rule_type === 'threshold' && (
        <div className="space-y-1.5">
          <span className="text-[11px] text-slate-400">Tiers (cutoff → points, first match wins)</span>
          {(cfg.tiers ?? []).map((tier, i) => (
            <div key={i} className="flex gap-2">
              <input value={tier.by} onChange={(e) => {
                const tiers = [...cfg.tiers]; tiers[i] = { ...tier, by: e.target.value }; setCfg({ tiers })
              }} placeholder="e.g. 04:30" className={cn(inputBase, '!py-1 text-xs flex-1')} />
              <input type="number" value={tier.pts} onChange={(e) => {
                const tiers = [...cfg.tiers]; tiers[i] = { ...tier, pts: Number(e.target.value) }; setCfg({ tiers })
              }} placeholder="pts" className={cn(inputBase, '!py-1 text-xs w-20')} />
              <button onClick={() => setCfg({ tiers: cfg.tiers.filter((_, idx) => idx !== i) })} className="text-slate-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setCfg({ tiers: [...(cfg.tiers ?? []), { by: '', pts: 0 }] })}
            className="text-xs text-saffron-600 font-semibold"
          >+ Add tier</button>
        </div>
      )}

      {draft.rule_type === 'penalty' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-slate-400">Deduction per unit</span>
            <input type="number" value={cfg.per_unit ?? 0} onChange={(e) => setCfg({ per_unit: Number(e.target.value) })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Unit size</span>
            <input type="number" value={cfg.unit ?? 1} onChange={(e) => setCfg({ unit: Number(e.target.value) })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
          </label>
        </div>
      )}

      {draft.rule_type === 'formula' && (
        <label className="block">
          <span className="text-[11px] text-slate-400">Expression (field keys as variables)</span>
          <input value={cfg.expr ?? ''} onChange={(e) => setCfg({ expr: e.target.value })} placeholder="e.g. japa_rounds * 10.9375" className={cn(inputBase, '!py-1.5 mt-0.5 font-mono')} />
        </label>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onDelete} className="text-xs text-red-500 font-semibold px-2 py-1">Delete rule</button>
        <Button size="sm" onClick={() => onSave(draft)}>Save rule</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fields panel
// ---------------------------------------------------------------------------
function FieldsPanel({ fields, groups, rules, onFieldsChange, onRulesChange, toast, trackerId }) {
  const [expanded, setExpanded] = useState(null)
  const [newLabel, setNewLabel] = useState('')

  const rulesByField = useMemo(() => {
    const out = {}
    for (const r of rules) { (out[r.field_key] = out[r.field_key] ?? []).push(r) }
    return out
  }, [rules])

  const addField = async () => {
    if (!newLabel.trim()) return
    const base = slugify(newLabel) || 'field'
    let key = base, n = 2
    while (fields.some((f) => f.key === key)) { key = `${base}_${n}`; n += 1 }
    try {
      const { data, error } = await supabase.from('tracker_fields').insert({
        tracker_id: trackerId, key, label: newLabel.trim(), field_type: 'number', sort_order: (fields.length + 1) * 10,
      }).select().single()
      if (error) throw error
      onFieldsChange([...fields, data])
      setNewLabel('')
    } catch (e) { toast.error('Could not add field', e.message) }
  }

  const updateField = async (field, patch) => {
    onFieldsChange(fields.map((f) => (f.id === field.id ? { ...f, ...patch } : f)))
    const { error } = await supabase.from('tracker_fields').update(patch).eq('id', field.id)
    if (error) toast.error('Could not save field', error.message)
  }

  const moveField = async (index, dir) => {
    const next = [...fields]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const reindexed = reindex(next)
    onFieldsChange(reindexed)
    await Promise.all(reindexed.map((f) => supabase.from('tracker_fields').update({ sort_order: f.sort_order }).eq('id', f.id)))
  }

  const deleteField = async (field) => {
    if (!window.confirm(`Delete field "${field.label}"? This does not delete past submitted values.`)) return
    try {
      await supabase.from('tracker_scoring_rules').delete().eq('tracker_id', trackerId).eq('field_key', field.key)
      const { error } = await supabase.from('tracker_fields').delete().eq('id', field.id)
      if (error) throw error
      onFieldsChange(fields.filter((f) => f.id !== field.id))
      onRulesChange(rules.filter((r) => r.field_key !== field.key))
      toast.success('Field deleted')
    } catch (e) { toast.error('Could not delete field', e.message) }
  }

  const addRule = async (field) => {
    try {
      const { data, error } = await supabase.from('tracker_scoring_rules').insert({
        tracker_id: trackerId, field_key: field.key, rule_type: 'range', label: field.label, max_points: 10, config: {}, sort_order: (rules.length + 1) * 10,
      }).select().single()
      if (error) throw error
      onRulesChange([...rules, data])
    } catch (e) { toast.error('Could not add rule', e.message) }
  }

  const saveRule = async (rule) => {
    const { error } = await supabase.from('tracker_scoring_rules').update({
      rule_type: rule.rule_type, max_points: Number(rule.max_points) || 0, config: rule.config ?? {},
    }).eq('id', rule.id)
    if (error) { toast.error('Could not save rule', error.message); return }
    onRulesChange(rules.map((r) => (r.id === rule.id ? rule : r)))
    toast.success('Rule saved')
  }

  const deleteRule = async (rule) => {
    const { error } = await supabase.from('tracker_scoring_rules').delete().eq('id', rule.id)
    if (error) { toast.error('Could not delete rule', error.message); return }
    onRulesChange(rules.filter((r) => r.id !== rule.id))
  }

  return (
    <Card>
      <CardHeader><p className="text-sm font-bold text-slate-800">Fields</p></CardHeader>
      <CardBody className="space-y-2">
        {fields.map((field, i) => {
          const isOpen = expanded === field.id
          const fieldRules = rulesByField[field.key] ?? []
          return (
            <div key={field.id} className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="flex items-center gap-2 p-2.5 bg-slate-50">
                <div className="flex flex-col">
                  <button onClick={() => moveField(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-600 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} className="text-slate-400 hover:text-slate-600 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                </div>
                <button onClick={() => setExpanded(isOpen ? null : field.id)} className="flex-1 text-left">
                  <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                  <span className="ml-2 text-[10px] font-mono text-slate-400">{field.key}</span>
                  {fieldRules.length > 0 && <Badge variant="tulasi" className="ml-2">{fieldRules.length} rule{fieldRules.length > 1 ? 's' : ''}</Badge>}
                  {field.is_active === false && <Badge variant="default" className="ml-2">Inactive</Badge>}
                </button>
                <button onClick={() => deleteField(field)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {isOpen && (
                <div className="p-3 space-y-3 bg-white">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Label</span>
                      <input defaultValue={field.label} onBlur={(e) => e.target.value !== field.label && updateField(field, { label: e.target.value })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Short code (WhatsApp variable)</span>
                      <input defaultValue={field.short_code ?? ''} placeholder={field.key.toUpperCase()} onBlur={(e) => e.target.value !== field.short_code && updateField(field, { short_code: e.target.value.toUpperCase() || null })} className={cn(inputBase, '!py-1.5 mt-0.5 font-mono')} />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Input Type</span>
                      <select value={field.field_type} onChange={(e) => updateField(field, { field_type: e.target.value })} className={cn(inputBase, '!py-1.5 mt-0.5')}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Unit</span>
                      <input defaultValue={field.unit ?? ''} placeholder="minutes, rounds…" onBlur={(e) => e.target.value !== field.unit && updateField(field, { unit: e.target.value || null })} className={cn(inputBase, '!py-1.5 mt-0.5')} />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Group</span>
                      <select value={field.group_id ?? ''} onChange={(e) => updateField(field, { group_id: e.target.value || null })} className={cn(inputBase, '!py-1.5 mt-0.5')}>
                        <option value="">— Ungrouped —</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Missed-day behavior</span>
                      <select value={field.missed_day_behavior} onChange={(e) => updateField(field, { missed_day_behavior: e.target.value })} className={cn(inputBase, '!py-1.5 mt-0.5')}>
                        <option value="zero">Count as zero</option>
                        <option value="exclude">Exclude from total</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={field.show_input !== false} onChange={(e) => updateField(field, { show_input: e.target.checked })} /> Show input column
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={field.show_marks !== false} onChange={(e) => updateField(field, { show_marks: e.target.checked })} /> Show marks column
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={field.is_required} onChange={(e) => updateField(field, { is_required: e.target.checked })} /> Mandatory
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={field.is_active !== false} onChange={(e) => updateField(field, { is_active: e.target.checked })} /> Active
                    </label>
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">Scoring Rules</span>
                      <Button size="sm" variant="secondary" icon={Plus} onClick={() => addRule(field)}>Add Rule</Button>
                    </div>
                    {fieldRules.map((rule) => (
                      <RuleEditor key={rule.id} rule={rule} onSave={saveRule} onDelete={() => deleteRule(rule)} />
                    ))}
                    {!fieldRules.length && <p className="text-xs text-slate-400">No scoring rules — this field won't contribute to the score.</p>}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div className="flex gap-2 pt-1">
          <input
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New field label, e.g. Studies"
            className={cn(inputBase, 'flex-1')}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addField())}
          />
          <Button size="sm" icon={Plus} onClick={addField}>Add Field</Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Calculated columns panel
// ---------------------------------------------------------------------------
function CalculatedColumnsPanel({ columns, fields, groups, onChange, toast, trackerId }) {
  const [newLabel, setNewLabel] = useState('')

  const addColumn = async () => {
    if (!newLabel.trim()) return
    const key = slugify(newLabel) || `col_${Date.now()}`
    try {
      const { data, error } = await supabase.from('tracker_calculated_columns').insert({
        tracker_id: trackerId, key, label: newLabel.trim(), inputs: [], sort_order: (columns.length + 1) * 10,
      }).select().single()
      if (error) throw error
      onChange([...columns, data])
      setNewLabel('')
    } catch (e) { toast.error('Could not add column', e.message) }
  }

  const updateColumn = async (col, patch) => {
    onChange(columns.map((c) => (c.id === col.id ? { ...c, ...patch } : c)))
    await supabase.from('tracker_calculated_columns').update(patch).eq('id', col.id)
  }

  const toggleInput = (col, type, ref) => {
    const exists = (col.inputs ?? []).some((i) => i.type === type && i.ref === ref)
    const inputs = exists
      ? col.inputs.filter((i) => !(i.type === type && i.ref === ref))
      : [...(col.inputs ?? []), { type, ref }]
    updateColumn(col, { inputs })
  }

  const deleteColumn = async (col) => {
    if (!window.confirm(`Delete calculated column "${col.label}"?`)) return
    await supabase.from('tracker_calculated_columns').delete().eq('id', col.id)
    onChange(columns.filter((c) => c.id !== col.id))
  }

  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-bold text-slate-800">Calculated Columns</p>
        <p className="text-xs text-slate-400 mt-0.5">e.g. Body = TB + WU + DR, Total = Body + Soul</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {columns.map((col) => (
          <div key={col.id} className="rounded-xl border border-slate-100 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input defaultValue={col.label} onBlur={(e) => e.target.value !== col.label && updateColumn(col, { label: e.target.value })} className={cn(inputBase, '!py-1.5 flex-1')} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
                <input type="checkbox" checked={col.is_highlighted} onChange={(e) => updateColumn(col, { is_highlighted: e.target.checked })} /> Highlight
              </label>
              <button onClick={() => deleteColumn(col)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 mb-1">Groups</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const on = (col.inputs ?? []).some((i) => i.type === 'group' && i.ref === g.key)
                  return (
                    <button key={g.id} onClick={() => toggleInput(col, 'group', g.key)} className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border', on ? 'bg-saffron-500 text-white border-transparent' : 'bg-white text-slate-500 border-slate-200')}>
                      {g.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 mb-1">Fields</p>
              <div className="flex flex-wrap gap-1.5">
                {fields.map((f) => {
                  const on = (col.inputs ?? []).some((i) => i.type === 'field' && i.ref === f.key)
                  return (
                    <button key={f.id} onClick={() => toggleInput(col, 'field', f.key)} className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border', on ? 'bg-tulasi-500 text-white border-transparent' : 'bg-white text-slate-500 border-slate-200')}>
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 mb-1">Other calculated columns</p>
              <div className="flex flex-wrap gap-1.5">
                {columns.filter((c) => c.id !== col.id).map((c) => {
                  const on = (col.inputs ?? []).some((i) => i.type === 'column' && i.ref === c.key)
                  return (
                    <button key={c.id} onClick={() => toggleInput(col, 'column', c.key)} className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border', on ? 'bg-lotus-500 text-white border-transparent' : 'bg-white text-slate-500 border-slate-200')}>
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New column, e.g. Total" className={cn(inputBase, 'flex-1')} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addColumn())} />
          <Button size="sm" icon={Plus} onClick={addColumn}>Add</Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// WhatsApp template panel
// ---------------------------------------------------------------------------
function WhatsAppPanel({ trackerId, fields, groups, columns, toast }) {
  const [template, setTemplate] = useState(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('tracker_whatsapp_templates').select('*').eq('tracker_id', trackerId).is('user_id', null).maybeSingle()
      .then(({ data }) => { setTemplate(data); setBody(data?.body ?? FALLBACK_TEMPLATE) })
  }, [trackerId])

  const save = async () => {
    setSaving(true)
    try {
      if (template) {
        await supabase.from('tracker_whatsapp_templates').update({ body }).eq('id', template.id)
      } else {
        const { data } = await supabase.from('tracker_whatsapp_templates').insert({
          tracker_id: trackerId, user_id: null, name: 'Default', body, is_default: true,
        }).select().single()
        setTemplate(data)
      }
      toast.success('Template saved')
    } catch (e) { toast.error('Could not save template', e.message) } finally { setSaving(false) }
  }

  const availableVars = useMemo(() => {
    const out = ['DATE', 'DAY', 'DEVOTEE_NAME', 'TRACKER_NAME', 'DAILY_PERCENTAGE']
    for (const f of fields) out.push((f.short_code || f.key).toUpperCase())
    for (const g of groups) out.push(`${g.key.toUpperCase()}_SCORE`)
    for (const c of columns) { out.push(c.key.toUpperCase()); out.push(`${c.key.toUpperCase()}_PCT`) }
    return out
  }, [fields, groups, columns])

  return (
    <Card>
      <CardHeader><p className="text-sm font-bold text-slate-800">Daily WhatsApp Report Template</p></CardHeader>
      <CardBody className="space-y-3">
        <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} className={cn(inputBase, 'font-mono !py-2')} />
        <div>
          <p className="text-[11px] text-slate-400 mb-1.5">Available variables — tap to copy the placeholder text</p>
          <div className="flex flex-wrap gap-1.5">
            {availableVars.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => navigator.clipboard?.writeText(`{${v}}`)}
                className="px-2 py-1 rounded-lg text-[11px] font-mono bg-slate-100 text-slate-600 hover:bg-slate-200"
              >{`{${v}}`}</button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={save} loading={saving}>Save Template</Button>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Preview panel
// ---------------------------------------------------------------------------
function PreviewPanel({ fields, groups, rules, columns }) {
  const [values, setValues] = useState({})

  const result = useMemo(() => calculateEntryScore({ rules, fields, groups, calculatedColumns: columns, fieldValues: values }), [rules, fields, groups, columns, values])

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><p className="text-sm font-bold text-slate-800">Sample Values</p></CardHeader>
        <CardBody className="space-y-3">
          {fields.filter((f) => f.is_active !== false).map((f) => (
            <label key={f.id} className="block">
              <span className="text-xs text-slate-500">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
              {f.field_type === 'boolean' ? (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [f.key]: !v[f.key] }))}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', values[f.key] ? 'bg-tulasi-500 text-white' : 'bg-slate-100 text-slate-500')}
                  >{values[f.key] ? 'Yes' : 'No'}</button>
                </div>
              ) : (
                <input
                  type={f.field_type === 'time' ? 'time' : f.field_type === 'number' || f.field_type === 'duration_min' ? 'number' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={cn(inputBase, 'mt-1')}
                />
              )}
            </label>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><p className="text-sm font-bold text-slate-800">Computed Result</p></CardHeader>
        <CardBody className="space-y-3">
          <div className="text-center py-3 rounded-2xl bg-gradient-to-r from-saffron-50 to-orange-50">
            <p className="text-3xl font-extrabold text-saffron-600">{result.score ?? '—'}<span className="text-sm text-slate-400 font-medium">/100</span></p>
            <p className="text-xs text-slate-400">{result.earned.toFixed(1)} / {result.max.toFixed(1)} points</p>
          </div>
          {groups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Groups</p>
              {groups.map((g) => {
                const t = result.groupTotals[g.key]
                return <div key={g.key} className="flex justify-between text-sm py-1"><span>{g.label}</span><span className="font-semibold">{t?.earned.toFixed(1)} / {t?.max.toFixed(1)}</span></div>
              })}
            </div>
          )}
          {columns.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Calculated Columns</p>
              {columns.map((c) => {
                const t = result.columnTotals[c.key]
                return <div key={c.key} className="flex justify-between text-sm py-1"><span>{c.label}</span><span className="font-semibold">{t?.earned.toFixed(1)} / {t?.max.toFixed(1)}</span></div>
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function TrackerSettings() {
  const { trackerId } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [tab, setTab] = useState('fields')
  const [loading, setLoading] = useState(true)
  const [tracker, setTracker] = useState(null)
  const [groups, setGroups] = useState([])
  const [fields, setFields] = useState([])
  const [rules, setRules] = useState([])
  const [columns, setColumns] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTrackerConfig(trackerId)
      setTracker(data.tracker)
      setGroups((data.groups ?? []).sort((a, b) => a.sort_order - b.sort_order))
      setFields((data.fields ?? []).sort((a, b) => a.sort_order - b.sort_order))
      setRules(data.rules ?? [])
      setColumns((data.calculated_columns ?? []).sort((a, b) => a.sort_order - b.sort_order))
    } catch (e) {
      toast.error('Could not load tracker settings', e.message)
    } finally {
      setLoading(false)
    }
  }, [trackerId, toast])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-center text-slate-400">Loading settings…</div>
  if (!tracker) return <div className="p-8 text-center text-slate-400">Tracker not found.</div>

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trackers/${trackerId}`)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: tracker.color || '#f97316' }}>
          <SettingsIcon className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800">{tracker.name} — Settings</h1>
          <p className="text-xs text-slate-400">Configure groups, fields, scoring rules, calculated columns and reports</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-2xl overflow-x-auto">
        {TABS.map((t) => {
          const TabIcon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all',
                tab === t.key ? 'bg-white text-saffron-600 elev-1 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <TabIcon className="w-3.5 h-3.5" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'fields' && (
        <div className="space-y-4">
          <GroupsPanel groups={groups} onChange={setGroups} toast={toast} trackerId={trackerId} />
          <FieldsPanel fields={fields} groups={groups} rules={rules} onFieldsChange={setFields} onRulesChange={setRules} toast={toast} trackerId={trackerId} />
        </div>
      )}
      {tab === 'calculated' && (
        <CalculatedColumnsPanel columns={columns} fields={fields} groups={groups} onChange={setColumns} toast={toast} trackerId={trackerId} />
      )}
      {tab === 'whatsapp' && (
        <WhatsAppPanel trackerId={trackerId} fields={fields} groups={groups} columns={columns} toast={toast} />
      )}
      {tab === 'preview' && (
        <PreviewPanel fields={fields} groups={groups} rules={rules} columns={columns} />
      )}
    </div>
  )
}
