import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  Settings, User, Phone, Home, Save, ShieldCheck,
  Building2, LayoutGrid, Lock, ToggleLeft, ToggleRight,
  Plus, Trash2, ChevronDown, ChevronUp, Palette, KeyRound, Copy, Check
} from 'lucide-react'
import useAuthStore from '@/store/authStore'
import useOrgStore from '@/store/orgStore'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Can from '@/components/Can'
import { supabase } from '@/lib/supabase'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'

// ─── Org Settings Tab ────────────────────────────────────────────────────────

function OrgSettingsTab() {
  const { org, settings, _load } = useOrgStore()
  const toast = useToastStore()
  const [branding, setBranding] = useState(settings?.branding ?? {})
  const [terminology, setTerminology] = useState(settings?.terminology ?? {})
  const [saving, setSaving] = useState(false)

  const TERMS = [
    { key: 'member',      label: 'Member noun',      placeholder: 'Devotee' },
    { key: 'members',     label: 'Members plural',    placeholder: 'Devotees' },
    { key: 'mentor',      label: 'Mentor noun',       placeholder: 'Counsellor' },
    { key: 'mentee',      label: 'Mentee noun',       placeholder: 'Counsellee' },
    { key: 'mentorship',  label: 'Mentorship module', placeholder: 'Counsellor' },
    { key: 'trackers',    label: 'Trackers module',   placeholder: 'Sadhana' },
    { key: 'tasks',       label: 'Tasks module',      placeholder: 'Services' },
    { key: 'resources',   label: 'Resources module',  placeholder: 'Kitchen' },
  ]

  const save = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('organization_settings')
        .upsert({ org_id: org.id, branding, terminology }, { onConflict: 'org_id' })
      if (error) throw error
      await _load()
      toast.success('Organization settings saved')
    } catch (e) {
      toast.error('Save failed', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Join code */}
      <JoinCodeCard code={org?.join_code} />

      {/* Branding */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-slate-500" />
            <h3 className="font-semibold text-slate-700">Branding</h3>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { key: 'shortName', label: 'Short Name', placeholder: 'SurabhiKunj' },
              { key: 'tagline',   label: 'Tagline',    placeholder: 'VOICE' },
              { key: 'logoUrl',   label: 'Logo URL',   placeholder: 'https://…/logo.png' },
              { key: 'primaryColor', label: 'Primary Colour', placeholder: '#f97316', type: 'color' },
              { key: 'accentColor',  label: 'Accent Colour',  placeholder: '#ea580c', type: 'color' },
              { key: 'iconName',  label: 'Sidebar Icon (Lucide)', placeholder: 'Flame' },
            ].map(({ key, label, placeholder, type }) => (
              <label key={key} className="block">
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <div className="flex items-center gap-2 mt-1">
                  {type === 'color' && (
                    <input
                      type="color"
                      value={branding[key] ?? '#f97316'}
                      onChange={(e) => setBranding((b) => ({ ...b, [key]: e.target.value }))}
                      className="w-10 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                  )}
                  <input
                    type="text"
                    value={branding[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(e) => setBranding((b) => ({ ...b, [key]: e.target.value }))}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
              </label>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Terminology */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-slate-700">Terminology</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Override module and noun labels for your organization.
          </p>
        </CardHeader>
        <CardBody>
          <div className="grid sm:grid-cols-2 gap-3">
            {TERMS.map(({ key, label, placeholder }) => (
              <label key={key} className="block">
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <input
                  type="text"
                  value={terminology[key] ?? ''}
                  placeholder={placeholder}
                  onChange={(e) => setTerminology((t) => ({ ...t, [key]: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </label>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} icon={Save} loading={saving}>Save Organization Settings</Button>
      </div>
    </div>
  )
}

// ─── Join code ───────────────────────────────────────────────────────────────

function JoinCodeCard({ code }) {
  const toast = useToastStore()
  const [copied, setCopied] = useState(false)

  if (!code) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed', 'Select and copy the code manually.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-700">Join Code</h3>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Share this with people you want to join your organization.
        </p>
      </CardHeader>
      <CardBody>
        <div className="flex items-center gap-3">
          <code className="text-xl font-extrabold tracking-[0.2em] text-saffron-700 bg-saffron-50 px-4 py-2.5 rounded-xl">
            {code}
          </code>
          <Button size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Modules Tab ─────────────────────────────────────────────────────────────

function ModulesTab() {
  const { org, _load } = useOrgStore()
  const toast = useToastStore()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('organization_modules')
      .select('module_key, enabled, label_override, icon_override, sort_order, modules(name, icon, description, is_core, category)')
      .eq('org_id', org.id)
      .order('sort_order')
    setModules(data ?? [])
    setLoading(false)
  }, [org?.id])

  useEffect(() => { load() }, [load])

  const toggle = async (key, currentEnabled, isCore) => {
    if (isCore) { toast.error('Core modules cannot be disabled'); return }
    setSaving((s) => ({ ...s, [key]: true }))
    const { error } = await supabase
      .from('organization_modules')
      .update({ enabled: !currentEnabled })
      .eq('org_id', org.id)
      .eq('module_key', key)
    if (error) toast.error('Could not update module', error.message)
    else { await load(); await _load() }
    setSaving((s) => ({ ...s, [key]: false }))
  }

  const saveLabel = async (key, label, icon) => {
    setSaving((s) => ({ ...s, [`lbl_${key}`]: true }))
    await supabase
      .from('organization_modules')
      .update({ label_override: label?.trim() || null, icon_override: icon?.trim() || null })
      .eq('org_id', org.id)
      .eq('module_key', key)
    await _load()
    setSaving((s) => ({ ...s, [`lbl_${key}`]: false }))
    toast.success('Label saved')
  }

  const categories = [...new Set(modules.map((m) => m.modules?.category).filter(Boolean))]

  if (loading) return <div className="py-12 text-center text-slate-400">Loading modules…</div>

  return (
    <div className="space-y-6">
      {categories.map((cat) => (
        <div key={cat}>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{cat}</p>
          <div className="space-y-2">
            {modules
              .filter((m) => m.modules?.category === cat)
              .map((m) => (
                <ModuleRow
                  key={m.module_key}
                  module={m}
                  saving={saving}
                  onToggle={toggle}
                  onSaveLabel={saveLabel}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ModuleRow({ module: m, saving, onToggle, onSaveLabel }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(m.label_override ?? '')
  const [icon, setIcon]   = useState(m.icon_override ?? '')
  const isCore = m.modules?.is_core

  return (
    <Card className={cn('transition-all', !m.enabled && 'opacity-60')}>
      <CardBody className="py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggle(m.module_key, m.enabled, isCore)}
            disabled={isCore || saving[m.module_key]}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed transition-colors"
            title={isCore ? 'Core module — always on' : (m.enabled ? 'Disable' : 'Enable')}
          >
            {m.enabled
              ? <ToggleRight className="w-6 h-6 text-green-500" />
              : <ToggleLeft className="w-6 h-6" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-800 text-sm">
                {m.label_override ?? m.modules?.name}
              </p>
              {isCore && <Badge variant="default" className="text-[10px] py-0">Core</Badge>}
            </div>
            <p className="text-xs text-slate-400 truncate">{m.modules?.description}</p>
          </div>

          <button
            onClick={() => setOpen((o) => !o)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {open && (
          <div className="mt-3 pt-3 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Custom Label</span>
              <input
                type="text"
                value={label}
                placeholder={m.modules?.name}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Custom Icon (Lucide)</span>
              <input
                type="text"
                value={icon}
                placeholder={m.modules?.icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </label>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                size="sm"
                icon={Save}
                loading={saving[`lbl_${m.module_key}`]}
                onClick={() => onSaveLabel(m.module_key, label, icon)}
              >
                Save Label
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Roles Tab ───────────────────────────────────────────────────────────────

// Must stay in sync with the `permissions` catalog seeded in 22_rbac.sql —
// role_permissions.permission_key is a FK, so an unknown key cannot be saved.
const ALL_PERMISSIONS = [
  { group: 'Members',      keys: ['members.view','members.invite','members.approve','members.manage','members.remove'] },
  { group: 'Trackers',     keys: ['trackers.submit','trackers.view_own','trackers.view_all','trackers.manage'] },
  { group: 'Tasks',        keys: ['tasks.view_own','tasks.view_all','tasks.assign','tasks.manage','tasks.verify'] },
  { group: 'Resources',    keys: ['resources.view','resources.manage'] },
  { group: 'Mentorship',   keys: ['mentorship.view_own','mentorship.view_all','mentorship.manage'] },
  { group: 'Reports',      keys: ['reports.view','reports.export'] },
  { group: 'Events',       keys: ['events.view','events.create','events.manage','events.attendance'] },
  { group: 'Announcements',keys: ['announcements.view','announcements.manage','notifications.send'] },
  { group: 'Departments',  keys: ['departments.view','departments.manage','departments.assign'] },
  { group: 'Hierarchy',    keys: ['hierarchy.view','hierarchy.manage'] },
  { group: 'Roles',        keys: ['roles.view','roles.manage','roles.assign'] },
  { group: 'Org',          keys: ['org.settings.manage','org.modules.manage','org.billing.manage','org.audit.view'] },
]

function RolesTab() {
  const { org } = useOrgStore()
  const toast = useToastStore()
  const [roles, setRoles]           = useState([])
  const [permissions, setPerms]     = useState({})  // role_id → Set<perm_key>
  const [loading, setLoading]       = useState(true)
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating]     = useState(false)
  const [saving, setSaving]         = useState({})

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const { data: rolesData } = await supabase
      .from('roles')
      .select('id, name, description, is_system')
      .eq('org_id', org.id)
      .order('name')
    const { data: rp } = await supabase
      .from('role_permissions')
      .select('role_id, permission_key')
      .in('role_id', (rolesData ?? []).map((r) => r.id))
    const permMap = {}
    ;(rp ?? []).forEach(({ role_id, permission_key }) => {
      if (!permMap[role_id]) permMap[role_id] = new Set()
      permMap[role_id].add(permission_key)
    })
    setRoles(rolesData ?? [])
    setPerms(permMap)
    setLoading(false)
  }, [org?.id])

  useEffect(() => { load() }, [load])

  const createRole = async () => {
    if (!newRoleName.trim()) return
    setCreating(true)
    const { error } = await supabase
      .from('roles')
      .insert({ org_id: org.id, name: newRoleName.trim() })
    if (error) toast.error('Could not create role', error.message)
    else { setNewRoleName(''); await load(); toast.success('Role created') }
    setCreating(false)
  }

  const deleteRole = async (id, isSystem) => {
    if (isSystem) { toast.error('System roles cannot be deleted'); return }
    await supabase.from('roles').delete().eq('id', id)
    await load()
    toast.success('Role deleted')
  }

  const togglePerm = async (roleId, permKey, currentSet) => {
    const has = currentSet?.has(permKey)
    setSaving((s) => ({ ...s, [`${roleId}:${permKey}`]: true }))
    if (has) {
      await supabase.from('role_permissions')
        .delete().eq('role_id', roleId).eq('permission_key', permKey)
    } else {
      await supabase.from('role_permissions')
        .insert({ role_id: roleId, permission_key: permKey })
    }
    await load()
    setSaving((s) => ({ ...s, [`${roleId}:${permKey}`]: false }))
  }

  if (loading) return <div className="py-12 text-center text-slate-400">Loading roles…</div>

  return (
    <div className="space-y-6">
      {/* New role */}
      <Card>
        <CardBody className="flex items-center gap-3">
          <input
            type="text"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="New role name…"
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && createRole()}
          />
          <Button size="sm" icon={Plus} loading={creating} onClick={createRole}>Create Role</Button>
        </CardBody>
      </Card>

      {roles.map((role) => (
        <RoleRow
          key={role.id}
          role={role}
          permSet={permissions[role.id] ?? new Set()}
          saving={saving}
          onTogglePerm={togglePerm}
          onDelete={deleteRole}
        />
      ))}
    </div>
  )
}

function RoleRow({ role, permSet, saving, onTogglePerm, onDelete }) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800">{role.name}</p>
              {role.is_system && <Badge variant="default" className="text-[10px] py-0">System</Badge>}
            </div>
            <p className="text-xs text-slate-400">{permSet.size} permission{permSet.size !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            {!role.is_system && (
              <button
                onClick={() => onDelete(role.id, role.is_system)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setOpen((o) => !o)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
            {ALL_PERMISSIONS.map(({ group, keys }) => (
              <div key={group}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {keys.map((perm) => {
                    const active = permSet.has(perm)
                    const busyKey = `${role.id}:${perm}`
                    return (
                      <button
                        key={perm}
                        disabled={saving[busyKey]}
                        onClick={() => onTogglePerm(role.id, perm, permSet)}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full border font-medium transition-all',
                          active
                            ? 'bg-green-50 border-green-300 text-green-700'
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-400'
                        )}
                      >
                        {perm.split('.')[1]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { profile, updateProfile } = useAuthStore()
  const { t } = useOrgStore()

  const [form, setForm] = useState({
    spiritual_name: profile?.spiritual_name ?? '',
    legal_name:     profile?.legal_name     ?? '',
    phone:          profile?.phone          ?? '',
    room_number:    profile?.room_number    ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const changed = useMemo(() => {
    if (!profile) return false
    return (
      form.spiritual_name !== (profile.spiritual_name ?? '') ||
      form.legal_name     !== (profile.legal_name     ?? '') ||
      form.phone          !== (profile.phone          ?? '') ||
      form.room_number    !== (profile.room_number    ?? '')
    )
  }, [form, profile])

  if (!profile) return null

  const onSave = async () => {
    setSaving(true)
    await updateProfile(form)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><h3 className="font-semibold text-slate-700">Profile</h3></CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={profile.display_name ?? profile.spiritual_name} url={profile.avatar_url} size="lg" />
            <div>
              <p className="font-semibold text-slate-800">{profile.display_name ?? profile.spiritual_name}</p>
              <Badge variant="default" className="text-xs">{profile.role ?? t('member', 'Member')}</Badge>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Spiritual Name</span>
              <div className="relative mt-1">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={form.spiritual_name}
                  onChange={(e) => setForm((f) => ({ ...f, spiritual_name: e.target.value }))}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Legal Name</span>
              <input
                value={form.legal_name}
                onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Phone</span>
              <div className="relative mt-1">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Room / Unit</span>
              <div className="relative mt-1">
                <Home className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={form.room_number}
                  onChange={(e) => setForm((f) => ({ ...f, room_number: e.target.value }))}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-slate-400">Roles and permissions are managed by your organization admins.</p>
            <Button onClick={onSave} icon={Save} loading={saving} disabled={!changed}>
              {saved ? 'Saved ✓' : 'Save'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="py-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-green-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-700">Security</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Authentication is managed by Supabase Auth with permission-based access control per organization.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

const TABS = [
  { key: 'profile',  label: 'Profile',      icon: User,        permission: null },
  { key: 'org',      label: 'Organization', icon: Building2,   permission: 'org.settings.manage' },
  { key: 'modules',  label: 'Modules',      icon: LayoutGrid,  permission: 'org.modules.manage' },
  { key: 'roles',    label: 'Roles',        icon: Lock,        permission: 'roles.manage' },
]

export default function SettingsPage() {
  const { hasPermission } = useOrgStore()
  const visibleTabs = TABS.filter((t) => !t.permission || hasPermission(t.permission))
  const [activeTab, setActiveTab] = useState('profile')

  const activeKey = visibleTabs.find((t) => t.key === activeTab)?.key ?? visibleTabs[0]?.key

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-slate-500" />
        <h1 className="text-xl font-bold text-slate-800">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl w-fit">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              activeKey === key
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeKey === 'profile'  && <ProfileTab />}
      {activeKey === 'org'      && <Can permission="org.settings.manage"><OrgSettingsTab /></Can>}
      {activeKey === 'modules'  && <Can permission="org.modules.manage"><ModulesTab /></Can>}
      {activeKey === 'roles'    && <Can permission="roles.manage"><RolesTab /></Can>}
    </div>
  )
}
