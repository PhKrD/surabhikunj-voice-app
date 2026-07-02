import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Save, Plus, Trash2, Edit2, Clock, BookOpen, Heart, Moon, Sun, Star, ChevronDown, ChevronUp } from 'lucide-react'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import { formatScoringRule } from '@/lib/sadhanaConfigScoring'
import { cn } from '@/lib/utils'

const PARAMETER_INFO = {
  tb: { label: 'To Bed (TB)', icon: Moon, color: 'text-blue-500' },
  wu: { label: 'Wake Up (WU)', icon: Sun, color: 'text-yellow-500' },
  japa_rounds: { label: 'Japa Rounds', icon: Star, color: 'text-purple-500' },
  japa_time: { label: 'Japa Time', icon: Clock, color: 'text-purple-500' },
  reading: { label: 'Reading', icon: BookOpen, color: 'text-green-500' },
  hearing: { label: 'Hearing', icon: Heart, color: 'text-pink-500' },
  studies: { label: 'Studies', icon: BookOpen, color: 'text-indigo-500' },
  seva_hours: { label: 'Seva Hours', icon: Heart, color: 'text-orange-500' },
  ma: { label: 'Mangal Arti', icon: Star, color: 'text-saffron-500' },
  mc: { label: 'Morning Class', icon: BookOpen, color: 'text-tulasi-500' },
  cleanliness: { label: 'Cleanliness', icon: Star, color: 'text-blue-500' },
  dr: { label: 'Day Rest', icon: Clock, color: 'text-red-500' }
}

export default function SadhanaConfigEditor() {
  const { profile } = useAuthStore()
  const toast = useToastStore((s) => s.toast)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scoringRules, setScoringRules] = useState([])
  const [hearingSources, setHearingSources] = useState([])
  const [readingTypes, setReadingTypes] = useState([])
  const [editingRule, setEditingRule] = useState(null)
  const [expandedRule, setExpandedRule] = useState(null)

  const [migrationMissing, setMigrationMissing] = useState(false)

  const loadConfiguration = useCallback(async () => {
    setLoading(true)
    setMigrationMissing(false)
    try {
      const [rulesRes, hearingRes, readingRes] = await Promise.all([
        supabase
          .from('sadhana_scoring_rules')
          .select('*')
          .eq('voice_id', profile.voice_id)
          .order('display_order'),
        supabase
          .from('hearing_sources')
          .select('*')
          .eq('voice_id', profile.voice_id)
          .order('display_order'),
        supabase
          .from('reading_types')
          .select('*')
          .eq('voice_id', profile.voice_id)
          .order('display_order')
      ])

      // If ANY of the tables is missing, the migration hasn't been applied yet
      const anyMissing = [rulesRes, hearingRes, readingRes].some(
        (r) => r.error && /relation .* does not exist|schema cache/i.test(r.error.message || '')
      )
      if (anyMissing) {
        setMigrationMissing(true)
        setScoringRules([])
        setHearingSources([])
        setReadingTypes([])
        return
      }

      if (rulesRes.error) throw rulesRes.error
      if (hearingRes.error) throw hearingRes.error
      if (readingRes.error) throw readingRes.error

      setScoringRules(rulesRes.data || [])
      setHearingSources(hearingRes.data || [])
      setReadingTypes(readingRes.data || [])
    } catch (error) {
      console.error('[config] load failed:', error)
      toast.error('Failed to load configuration', error.message)
    } finally {
      setLoading(false)
    }
  }, [profile, toast])

  useEffect(() => {
    if (!profile?.voice_id) return
    // Defer the load to avoid setState in effect warning
    const timer = setTimeout(loadConfiguration, 0)
    return () => clearTimeout(timer)
  }, [profile?.voice_id, loadConfiguration])

  const saveRule = async (rule) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('sadhana_scoring_rules')
        .upsert({
          ...rule,
          voice_id: profile.voice_id,
          created_by: profile.id
        }, { onConflict: 'voice_id,parameter' })
      
      if (error) throw error
      
      toast.success('Scoring rule saved successfully')
      await loadConfiguration()
      setEditingRule(null)
    } catch (error) {
      toast.error('Failed to save rule', error.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteSource = async (type, id) => {
    const table = type === 'hearing' ? 'hearing_sources' : 'reading_types'
    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
      
      if (error) throw error
      
      toast.success(`${type === 'hearing' ? 'Hearing source' : 'Reading type'} deleted`)
      await loadConfiguration()
    } catch (error) {
      toast.error('Failed to delete', error.message)
    }
  }

  const addSource = async (type) => {
    const table = type === 'hearing' ? 'hearing_sources' : 'reading_types'
    const name = prompt(`Enter ${type === 'hearing' ? 'hearing source' : 'reading type'} name:`)
    
    if (!name) return
    
    try {
      const { error } = await supabase
        .from(table)
        .insert({
          voice_id: profile.voice_id,
          name,
          display_order: type === 'hearing' ? hearingSources.length : readingTypes.length
        })
      
      if (error) throw error
      
      toast.success(`${type === 'hearing' ? 'Hearing source' : 'Reading type'} added`)
      await loadConfiguration()
    } catch (error) {
      toast.error('Failed to add', error.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-slate-400">Loading configuration...</div>
  }

  if (migrationMissing) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardBody className="text-center py-10 space-y-3">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-yellow-50 flex items-center justify-center">
              <Save className="w-6 h-6 text-yellow-600" />
            </div>
            <h3 className="font-semibold text-slate-700">Database setup required</h3>
            <p className="text-sm text-slate-500">
              The configurable scoring tables have not been created yet. Run the SQL migration
              <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded text-xs">supabase/14_sadhana_config.sql</code>
              in your Supabase project (SQL editor) and then reload this page.
            </p>
            <Button onClick={loadConfiguration} icon={Save} variant="ghost">
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Scoring Rules */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-700">Sadhana Scoring Rules</h3>
          <Badge variant="blue">Per Day Configuration</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          {scoringRules.map((rule) => {
            const info = PARAMETER_INFO[rule.parameter] || {}
            const Icon = info.icon || Clock
            const isExpanded = expandedRule === rule.id
            const isEditing = editingRule?.id === rule.id
            
            return (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border border-slate-200 rounded-xl overflow-hidden"
              >
                <div
                  className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn('w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center', info.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">{info.label || rule.parameter}</p>
                      <p className="text-xs text-slate-500">Max: {rule.max_points} points</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {rule.is_active ? (
                      <Badge variant="tulasi">Active</Badge>
                    ) : (
                      <Badge variant="gray">Inactive</Badge>
                    )}
                    {isExpanded ? <ChevronUp /> : <ChevronDown />}
                  </div>
                </div>
                
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-slate-100">
                        {isEditing ? (
                          <RuleEditor
                            rule={editingRule}
                            onChange={setEditingRule}
                            onSave={() => saveRule(editingRule)}
                            onCancel={() => setEditingRule(null)}
                            saving={saving}
                          />
                        ) : (
                          <div className="pt-4 space-y-3">
                            <div>
                              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Current Configuration</p>
                              <p className="text-sm text-slate-700 font-mono">{formatScoringRule(rule)}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={Edit2}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingRule(rule)
                                }}
                              >
                                Edit Configuration
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </CardBody>
      </Card>

      {/* Hearing Sources */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-700">Hearing Sources</h3>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => addSource('hearing')}>
            Add Source
          </Button>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            {hearingSources.map((source) => (
              <div key={source.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-700">{source.name}</p>
                  {source.abbreviation && (
                    <p className="text-xs text-slate-500">Abbreviation: {source.abbreviation}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => deleteSource('hearing', source.id)}
                  className="text-red-500 hover:text-red-600"
                />
              </div>
            ))}
            {hearingSources.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No hearing sources configured</p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Reading Types */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-700">Reading Types</h3>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => addSource('reading')}>
            Add Type
          </Button>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            {readingTypes.map((type) => (
              <div key={type.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                <p className="text-sm font-medium text-slate-700">{type.name}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => deleteSource('reading', type.id)}
                  className="text-red-500 hover:text-red-600"
                />
              </div>
            ))}
            {readingTypes.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No reading types configured</p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// Rule editor component for editing scoring configurations
function RuleEditor({ rule, onChange, onSave, onCancel, saving }) {
  const updateConfig = (key, value) => {
    onChange({
      ...rule,
      config: { ...rule.config, [key]: value }
    })
  }

  const addCutoff = () => {
    const cutoffs = rule.config.cutoffs || []
    updateConfig('cutoffs', [...cutoffs, { time: '00:00', points: 0 }])
  }

  const addTier = () => {
    const key = rule.rule_type === 'rounds' ? 'tiers' :
                rule.rule_type === 'seva_hours' ? 'tiers' :
                rule.rule_type === 'duration_min' && rule.parameter === 'dr' ? 'penalty_tiers' :
                'tiers'
    const tiers = rule.config[key] || []
    const newTier = rule.rule_type === 'rounds' ? { rounds: 0, points: 0 } :
                    rule.rule_type === 'seva_hours' ? { hours: 0, points: 0 } :
                    { minutes: 0, points: 0 }
    updateConfig(key, [...tiers, newTier])
  }

  const removeCutoff = (index) => {
    const cutoffs = [...(rule.config.cutoffs || [])]
    cutoffs.splice(index, 1)
    updateConfig('cutoffs', cutoffs)
  }

  const removeTier = (index, key) => {
    const tiers = [...(rule.config[key] || [])]
    tiers.splice(index, 1)
    updateConfig(key, tiers)
  }

  return (
    <div className="pt-4 space-y-4">
      {/* Max Points */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Max Points</label>
        <input
          type="number"
          value={rule.max_points}
          onChange={(e) => onChange({ ...rule, max_points: parseFloat(e.target.value) })}
          className="mt-1 w-32 px-3 py-2 rounded-lg border border-slate-200 text-sm"
          step="0.5"
        />
      </div>

      {/* Time-based rules */}
      {(rule.rule_type === 'time_before' || rule.rule_type === 'time_after') && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Time Cutoffs</label>
            <Button size="sm" variant="ghost" icon={Plus} onClick={addCutoff}>Add</Button>
          </div>
          <div className="space-y-2">
            {(rule.config.cutoffs || []).map((cutoff, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="time"
                  value={cutoff.time}
                  onChange={(e) => {
                    const cutoffs = [...rule.config.cutoffs]
                    cutoffs[index] = { ...cutoffs[index], time: e.target.value }
                    updateConfig('cutoffs', cutoffs)
                  }}
                  className="px-2 py-1 rounded border border-slate-200 text-sm"
                />
                <span className="text-sm">→</span>
                <input
                  type="number"
                  value={cutoff.points}
                  onChange={(e) => {
                    const cutoffs = [...rule.config.cutoffs]
                    cutoffs[index] = { ...cutoffs[index], points: parseFloat(e.target.value) }
                    updateConfig('cutoffs', cutoffs)
                  }}
                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm"
                  step="0.5"
                />
                <span className="text-sm">pts</span>
                <Button size="sm" variant="ghost" onClick={() => removeCutoff(index)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duration-based rules */}
      {rule.rule_type === 'duration_min' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {rule.parameter === 'dr' ? 'Penalty Tiers' : 'Duration Tiers'}
            </label>
            <Button size="sm" variant="ghost" icon={Plus} onClick={addTier}>Add</Button>
          </div>
          <div className="space-y-2">
            {((rule.parameter === 'dr' ? rule.config.penalty_tiers : rule.config.tiers) || []).map((tier, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="number"
                  value={tier.minutes}
                  onChange={(e) => {
                    const key = rule.parameter === 'dr' ? 'penalty_tiers' : 'tiers'
                    const tiers = [...rule.config[key]]
                    tiers[index] = { ...tiers[index], minutes: parseInt(e.target.value) }
                    updateConfig(key, tiers)
                  }}
                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm"
                />
                <span className="text-sm">min →</span>
                <input
                  type="number"
                  value={tier.points}
                  onChange={(e) => {
                    const key = rule.parameter === 'dr' ? 'penalty_tiers' : 'tiers'
                    const tiers = [...rule.config[key]]
                    tiers[index] = { ...tiers[index], points: parseFloat(e.target.value) }
                    updateConfig(key, tiers)
                  }}
                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm"
                  step="0.5"
                />
                <span className="text-sm">pts</span>
                <Button size="sm" variant="ghost" onClick={() => removeTier(index, rule.parameter === 'dr' ? 'penalty_tiers' : 'tiers')}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rounds-based rules */}
      {rule.rule_type === 'rounds' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rounds Tiers</label>
            <Button size="sm" variant="ghost" icon={Plus} onClick={addTier}>Add</Button>
          </div>
          <div className="space-y-2">
            {(rule.config.tiers || []).map((tier, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="number"
                  value={tier.rounds}
                  onChange={(e) => {
                    const tiers = [...rule.config.tiers]
                    tiers[index] = { ...tiers[index], rounds: parseInt(e.target.value) }
                    updateConfig('tiers', tiers)
                  }}
                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm"
                />
                <span className="text-sm">rounds →</span>
                <input
                  type="number"
                  value={tier.points}
                  onChange={(e) => {
                    const tiers = [...rule.config.tiers]
                    tiers[index] = { ...tiers[index], points: parseFloat(e.target.value) }
                    updateConfig('tiers', tiers)
                  }}
                  className="w-20 px-2 py-1 rounded border border-slate-200 text-sm"
                  step="0.5"
                />
                <span className="text-sm">pts</span>
                <Button size="sm" variant="ghost" onClick={() => removeTier(index, 'tiers')}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boolean rules */}
      {rule.rule_type === 'boolean' && (
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Points if Yes</label>
          <input
            type="number"
            value={rule.config.points_if_true || 0}
            onChange={(e) => updateConfig('points_if_true', parseFloat(e.target.value))}
            className="mt-1 w-32 px-3 py-2 rounded-lg border border-slate-200 text-sm"
            step="0.5"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} loading={saving} icon={Save} variant="primary" size="sm">
          Save Configuration
        </Button>
        <Button onClick={onCancel} variant="ghost" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  )
}
