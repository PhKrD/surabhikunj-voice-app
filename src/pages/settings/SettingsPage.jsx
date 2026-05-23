import { useMemo, useState } from 'react'
import { Settings, User, Phone, Home, Save, ShieldCheck } from 'lucide-react'
import useAuthStore from '@/store/authStore'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { ROLES, ROLE_COLORS } from '@/lib/utils'

export default function SettingsPage() {
  const { profile, updateProfile } = useAuthStore()

  const [form, setForm] = useState({
    spiritual_name: profile?.spiritual_name ?? '',
    legal_name: profile?.legal_name ?? '',
    phone: profile?.phone ?? '',
    room_number: profile?.room_number ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const changed = useMemo(() => {
    if (!profile) return false
    return (
      form.spiritual_name !== (profile.spiritual_name ?? '') ||
      form.legal_name !== (profile.legal_name ?? '') ||
      form.phone !== (profile.phone ?? '') ||
      form.room_number !== (profile.room_number ?? '')
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
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-saffron-500" />
        <h2 className="text-lg font-bold text-slate-800">Settings</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-semibold text-slate-700">Profile</h3>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={profile.spiritual_name} url={profile.avatar_url} size="lg" />
            <div>
              <p className="font-semibold text-slate-800">{profile.spiritual_name}</p>
              <Badge className={ROLE_COLORS[profile.role]}>{ROLES[profile.role]}</Badge>
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
              <span className="text-xs text-slate-500 font-medium">Room Number</span>
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
            <p className="text-xs text-slate-400">Role and permissions are managed by VOICE admins.</p>
            <Button onClick={onSave} icon={Save} loading={saving} disabled={!changed}>
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="py-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-tulasi-600 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-700">Security</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Authentication is handled through Supabase Auth with role-based access control and tenant-level isolation.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
