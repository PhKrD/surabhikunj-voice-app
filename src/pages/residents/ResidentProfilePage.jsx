import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, MapPin, Phone, CalendarDays, Pencil, Save, X, BadgeCheck, BookOpen } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import { ROLES, ROLE_COLORS, formatDate, scoreBg, isAdmin } from '@/lib/utils'

const PROFILE_SELECT = '*, counsellor:counsellor_id(id, spiritual_name, avatar_url, role)'
const inputCls =
  'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-saffron-300 focus:border-transparent transition'

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className="flex-1 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="text-sm font-medium text-slate-800 text-right">{value || '—'}</span>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function ToggleField({ label, value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition ${
        value ? 'bg-tulasi-50 border-tulasi-200 text-tulasi-700' : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}
    >
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${value ? 'border-tulasi-500 bg-tulasi-500' : 'border-slate-300'}`}>
        {value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      {label}
    </button>
  )
}

export default function ResidentProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile: me } = useAuthStore()
  const toast = useToastStore()
  const canEdit = isAdmin(me?.role)

  const [resident, setResident] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    legal_name: '', role: 'devotee', phone: '', room_number: '', joined_date: '', initiated: false, is_active: true,
  })

  const load = useCallback(async () => {
    if (!me || !id) return
    setLoading(true)
    const [resRes, reportsRes] = await Promise.all([
      supabase.from('profiles').select(PROFILE_SELECT).eq('id', id).maybeSingle(),
      supabase.from('sadhana_reports').select('id, report_date, score').eq('profile_id', id).order('report_date', { ascending: false }).limit(7),
    ])
    setResident(resRes.data ?? null)
    setReports(reportsRes.data ?? [])
    setLoading(false)
  }, [me, id])

  useEffect(() => {
    const t = setTimeout(() => { load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  const startEdit = () => {
    if (!resident) return
    setForm({
      legal_name: resident.legal_name ?? '',
      role: resident.role ?? 'devotee',
      phone: resident.phone ?? '',
      room_number: resident.room_number ?? '',
      joined_date: resident.joined_date ?? '',
      initiated: !!resident.initiated,
      is_active: resident.is_active !== false,
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        legal_name: form.legal_name || null,
        role: form.role,
        phone: form.phone || null,
        room_number: form.room_number || null,
        joined_date: form.joined_date || null,
        initiated: form.initiated,
        is_active: form.is_active,
      }
      const { data, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', id)
        .select(PROFILE_SELECT)
        .maybeSingle()
      if (error) throw error
      setResident(data)
      setEditing(false)
      toast.success('Resident updated')
    } catch (e) {
      toast.error('Could not update resident', e.message)
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>

  if (!resident) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => navigate('/residents')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Back to Residents
        </button>
        <Card>
          <CardBody>
            <div className="py-10 text-center text-slate-400 text-sm">Resident not found or not in your VOICE.</div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const counsellor = resident.counsellor

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/residents')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {canEdit && !editing && (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={startEdit}>Edit</Button>
        )}
      </div>

      {/* Header */}
      <Card>
        <CardBody className="py-5">
          <div className="flex items-center gap-4">
            <Avatar name={resident.spiritual_name} url={resident.avatar_url} size="xl" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">{resident.spiritual_name}</h2>
              {resident.legal_name && <p className="text-sm text-slate-500">{resident.legal_name}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge className={ROLE_COLORS[resident.role]}>{ROLES[resident.role] ?? resident.role}</Badge>
                {resident.initiated && <Badge variant="saffron">Initiated</Badge>}
                {!resident.is_active && <Badge variant="red">Inactive</Badge>}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {editing ? (
        <Card>
          <CardHeader><h3 className="font-semibold text-slate-700">Edit Resident</h3></CardHeader>
          <CardBody className="space-y-3">
            <Field label="Legal Name">
              <input value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => set('role', e.target.value)} className={inputCls}>
                {Object.entries(ROLES).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone">
                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Room Number">
                <input value={form.room_number} onChange={(e) => set('room_number', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Joined Date">
              <input type="date" value={form.joined_date ?? ''} onChange={(e) => set('joined_date', e.target.value)} className={inputCls} />
            </Field>
            <div className="flex flex-wrap gap-3 pt-1">
              <ToggleField label="Initiated" value={form.initiated} onChange={(v) => set('initiated', v)} />
              <ToggleField label="Active" value={form.is_active} onChange={(v) => set('is_active', v)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={save} loading={saving} icon={Save}>Save</Button>
              <Button variant="secondary" icon={X} onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><h3 className="font-semibold text-slate-700">Details</h3></CardHeader>
            <CardBody>
              <DetailRow icon={Phone} label="Phone" value={resident.phone} />
              <DetailRow icon={MapPin} label="Room" value={resident.room_number} />
              <DetailRow icon={CalendarDays} label="Joined" value={resident.joined_date ? formatDate(resident.joined_date) : null} />
              <DetailRow icon={BadgeCheck} label="Initiated" value={resident.initiated ? 'Yes' : 'No'} />
            </CardBody>
          </Card>

          {counsellor && (
            <Card>
              <CardHeader><h3 className="font-semibold text-slate-700">Counsellor</h3></CardHeader>
              <CardBody>
                <div className="flex items-center gap-3">
                  <Avatar name={counsellor.spiritual_name} url={counsellor.avatar_url} size="md" />
                  <div>
                    <p className="font-semibold text-slate-800">{counsellor.spiritual_name}</p>
                    <Badge className={ROLE_COLORS[counsellor.role]}>{ROLES[counsellor.role] ?? counsellor.role}</Badge>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-lotus-500" />
                <h3 className="font-semibold text-slate-700">Recent Sadhana</h3>
              </div>
            </CardHeader>
            <CardBody>
              {reports.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">No sadhana reports visible.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {reports.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-2">
                      <span className="text-sm text-slate-600">{formatDate(r.report_date)}</span>
                      <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${scoreBg(r.score ?? 0)}`}>
                        {(r.score ?? 0).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
