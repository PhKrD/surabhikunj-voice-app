import { useEffect, useMemo, useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const {
  Bell,
  BellOff,
  Smartphone,
  MessageCircle,
  Moon,
  Lock,
  Check,
  Loader2,
  Save,
  SlidersHorizontal,
} = LucideIcons

const GROUP_LABELS = {
  services: 'Services',
  sadhana: 'Sadhana',
  cleanliness: 'Cleanliness',
  announcements: 'Announcements',
  events: 'Events',
  personal: 'Personal',
  system: 'System',
}

const GROUP_ORDER = ['services', 'sadhana', 'cleanliness', 'announcements', 'events', 'personal', 'system']

function iconFor(category) {
  const Resolved = category?.icon ? LucideIcons[category.icon] : null
  return Resolved ?? LucideIcons.Bell
}

function normalizeTime(value) {
  return value ? String(value).slice(0, 5) : ''
}

function Toggle({ on, onClick, disabled, busy, color = 'saffron', onLabel = 'On', offLabel = 'Off', icon: Icon }) {
  const activeColors = {
    saffron: 'bg-saffron-500 text-white border-saffron-500',
    tulasi: 'bg-tulasi-500 text-white border-tulasi-500',
    rose: 'bg-rose-500 text-white border-rose-500',
  }
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all min-w-[76px]',
        on ? activeColors[color] : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
        (disabled || busy) && 'opacity-60 cursor-not-allowed hover:border-slate-200'
      )}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : on ? (
        <Check className="w-3.5 h-3.5" />
      ) : Icon ? (
        <Icon className="w-3.5 h-3.5" />
      ) : null}
      {on ? onLabel : offLabel}
    </button>
  )
}

export default function NotificationPreferences() {
  const { profile } = useAuthStore()
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)

  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [prefs, setPrefs] = useState({})
  const [settings, setSettings] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [busy, setBusy] = useState(() => new Set())

  const [form, setForm] = useState({
    push_muted: false,
    whatsapp_opt_in: false,
    phone_e164: '',
    quiet_start: '',
    quiet_end: '',
  })

  useEffect(() => {
    if (!profile?.id) return undefined
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const [catsRes, prefsRes, settingsRes] = await Promise.all([
          supabase.from('notification_categories').select('*').order('sort_order'),
          supabase.from('notification_preferences').select('*').eq('profile_id', profile.id),
          supabase.from('notification_settings').select('*').eq('profile_id', profile.id).maybeSingle(),
        ])
        if (!active) return
        setCategories(catsRes.data ?? [])
        const map = {}
        for (const row of prefsRes.data ?? []) map[row.category_key] = row
        setPrefs(map)
        const s = settingsRes.data ?? null
        setSettings(s)
        setForm({
          push_muted: !!s?.push_muted,
          whatsapp_opt_in: !!s?.whatsapp_opt_in,
          phone_e164: s?.phone_e164 ?? '',
          quiet_start: normalizeTime(s?.quiet_start),
          quiet_end: normalizeTime(s?.quiet_end),
        })
      } catch (e) {
        if (active) toastError('Could not load preferences', e.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [profile?.id, toastError])

  const setBusyKey = (key, on) =>
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const effective = (cat, channel) => {
    const pref = prefs[cat.key]
    if (channel === 'inapp') return pref?.inapp_enabled ?? cat.default_inapp
    if (channel === 'push') return pref?.push_enabled ?? cat.default_push
    return pref?.whatsapp_enabled ?? cat.default_whatsapp
  }

  const grouped = useMemo(() => {
    const map = {}
    for (const cat of categories) {
      const key = cat.group_key ?? 'system'
      ;(map[key] ??= []).push(cat)
    }
    return map
  }, [categories])

  const groupKeys = useMemo(() => {
    const present = Object.keys(grouped)
    const ordered = GROUP_ORDER.filter((g) => present.includes(g))
    const extras = present.filter((g) => !GROUP_ORDER.includes(g))
    return [...ordered, ...extras]
  }, [grouped])

  const dirty = useMemo(() => {
    const s = settings
    return (
      !!form.push_muted !== !!s?.push_muted ||
      !!form.whatsapp_opt_in !== !!s?.whatsapp_opt_in ||
      (form.phone_e164 || '').trim() !== (s?.phone_e164 || '') ||
      (form.quiet_start || '') !== normalizeTime(s?.quiet_start) ||
      (form.quiet_end || '') !== normalizeTime(s?.quiet_end)
    )
  }, [form, settings])

  const toggleChannel = async (cat, channel) => {
    if (!profile?.id || !cat.user_can_disable) return
    const key = `${cat.key}:${channel}`
    const nextVal = !effective(cat, channel)
    const row = {
      profile_id: profile.id,
      category_key: cat.key,
      inapp_enabled: channel === 'inapp' ? nextVal : effective(cat, 'inapp'),
      push_enabled: channel === 'push' ? nextVal : effective(cat, 'push'),
      whatsapp_enabled: channel === 'whatsapp' ? nextVal : effective(cat, 'whatsapp'),
    }
    const previous = prefs
    setPrefs((m) => ({ ...m, [cat.key]: { ...(m[cat.key] ?? {}), ...row } }))
    setBusyKey(key, true)
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(row, { onConflict: 'profile_id,category_key' })
    setBusyKey(key, false)
    if (error) {
      setPrefs(previous)
      toastError('Could not update preference', error.message)
    } else {
      toastSuccess('Preferences updated')
    }
  }

  const saveSettings = async () => {
    if (!profile?.id) return
    setSavingSettings(true)
    const payload = {
      profile_id: profile.id,
      push_muted: form.push_muted,
      whatsapp_opt_in: form.whatsapp_opt_in,
      phone_e164: form.phone_e164.trim() || null,
      quiet_start: form.quiet_start || null,
      quiet_end: form.quiet_end || null,
    }
    const { error } = await supabase
      .from('notification_settings')
      .upsert(payload, { onConflict: 'profile_id' })
    setSavingSettings(false)
    if (error) {
      toastError('Could not save settings', error.message)
    } else {
      setSettings((prev) => ({ ...(prev ?? {}), ...payload }))
      toastSuccess('Settings saved')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading preferences…
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 transition disabled:bg-slate-50 disabled:text-slate-400'

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-saffron-50 text-saffron-600 flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <p className="font-bold text-slate-800">Global settings</p>
            <p className="text-xs text-slate-500">Applies to every notification.</p>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800 text-sm">Mute all push</p>
              <p className="text-xs text-slate-500 mt-0.5">Silence every push notification on your devices.</p>
            </div>
            <Toggle
              on={form.push_muted}
              color="rose"
              icon={BellOff}
              onLabel="Muted"
              offLabel="Active"
              onClick={() => setForm((f) => ({ ...f, push_muted: !f.push_muted }))}
            />
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 text-sm">WhatsApp notifications</p>
                <p className="text-xs text-slate-500 mt-0.5">Receive selected alerts on WhatsApp.</p>
              </div>
              <Toggle
                on={form.whatsapp_opt_in}
                color="tulasi"
                icon={MessageCircle}
                onLabel="On"
                offLabel="Off"
                onClick={() => setForm((f) => ({ ...f, whatsapp_opt_in: !f.whatsapp_opt_in }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Phone number</label>
              <input
                type="tel"
                value={form.phone_e164}
                onChange={(e) => setForm((f) => ({ ...f, phone_e164: e.target.value }))}
                placeholder="+919876543210"
                disabled={!form.whatsapp_opt_in}
                className={inputClass}
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Moon className="w-4 h-4 text-slate-500" />
              <p className="font-semibold text-slate-800 text-sm">Quiet hours</p>
            </div>
            <p className="text-xs text-slate-500 mb-3">No push during these hours.</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-500 mb-1 block">From</label>
                <input
                  type="time"
                  value={form.quiet_start}
                  onChange={(e) => setForm((f) => ({ ...f, quiet_start: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-500 mb-1 block">To</label>
                <input
                  type="time"
                  value={form.quiet_end}
                  onChange={(e) => setForm((f) => ({ ...f, quiet_end: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
            <Button size="sm" icon={Save} loading={savingSettings} disabled={!dirty} onClick={saveSettings}>
              Save settings
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {groupKeys.map((groupKey) => (
          <div key={groupKey}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-2">
              {GROUP_LABELS[groupKey] ?? groupKey}
            </p>
            <Card>
              <CardBody className="py-1 divide-y divide-slate-100">
                {grouped[groupKey].map((cat) => {
                  const Icon = iconFor(cat)
                  const locked = !cat.user_can_disable
                  return (
                    <div key={cat.key} className="py-3.5 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 text-sm">{cat.label}</p>
                          {cat.description && (
                            <p className="text-xs text-slate-500 mt-0.5">{cat.description}</p>
                          )}
                          {locked && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mt-1">
                              <Lock className="w-3 h-3" />
                              Always on
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 flex-shrink-0">
                        <Toggle
                          on={effective(cat, 'inapp')}
                          color="saffron"
                          icon={Bell}
                          onLabel="In-App"
                          offLabel="In-App"
                          disabled={locked}
                          busy={busy.has(`${cat.key}:inapp`)}
                          onClick={() => toggleChannel(cat, 'inapp')}
                        />
                        <Toggle
                          on={effective(cat, 'push')}
                          color="saffron"
                          icon={Smartphone}
                          onLabel="Push"
                          offLabel="Push"
                          disabled={locked}
                          busy={busy.has(`${cat.key}:push`)}
                          onClick={() => toggleChannel(cat, 'push')}
                        />
                        <Toggle
                          on={effective(cat, 'whatsapp')}
                          color="tulasi"
                          icon={MessageCircle}
                          onLabel="WhatsApp"
                          offLabel="WhatsApp"
                          disabled={locked}
                          busy={busy.has(`${cat.key}:whatsapp`)}
                          onClick={() => toggleChannel(cat, 'whatsapp')}
                        />
                      </div>
                    </div>
                  )
                })}
              </CardBody>
            </Card>
          </div>
        ))}

        {groupKeys.length === 0 && (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-10 text-slate-400">
                <Bell className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No notification categories configured.</p>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
