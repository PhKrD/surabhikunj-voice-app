import { useState } from 'react'
import { Megaphone, LifeBuoy, Link2, Plus, Trash2, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendlyError'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import Card, { CardHeader, CardBody, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { AppInput, AppSelect, AppTextarea } from '@/components/ui/Field'

const HTTPS = /^https:\/\/\S+$/i

/**
 * Admin-editable content that reaches every installed app on its next
 * resume — no release needed: the notice bar, support contacts and useful
 * links (organization_settings.content, migration 73).
 */
export default function ContentSettingsTab() {
  const { org, settings, _load } = useOrgStore()
  const toast = useToastStore()
  const initial = settings?.content ?? {}
  const [notice, setNotice] = useState({ enabled: false, tone: 'info', dismissible: true, ...initial.notice })
  const [support, setSupport] = useState({ ...initial.support })
  const [links, setLinks] = useState(Array.isArray(initial.links) ? initial.links : [])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const validate = () => {
    const next = {}
    if (notice.enabled && !notice.text?.trim()) next.noticeText = 'Write the notice, or turn it off.'
    if (notice.linkUrl && !HTTPS.test(notice.linkUrl)) next.noticeLink = 'Use a full https:// link.'
    links.forEach((l, i) => {
      if (l.url && !HTTPS.test(l.url)) next[`link${i}`] = 'Use a full https:// link.'
    })
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const content = {
        ...initial,
        // A new id on every save makes a changed notice reappear for people
        // who dismissed the previous one.
        notice: { ...notice, text: notice.text?.trim() ?? '', id: notice.text !== initial.notice?.text ? String(Date.now()) : (initial.notice?.id ?? String(Date.now())) },
        support: Object.fromEntries(Object.entries(support).map(([k, v]) => [k, (v ?? '').trim()])),
        links: links.filter((l) => l.label?.trim() && l.url?.trim()),
      }
      const { error } = await supabase
        .from('organization_settings')
        .upsert({ org_id: org.id, content }, { onConflict: 'org_id' })
      if (error) throw error
      await _load()
      toast.success('Saved', 'Members will see the changes the next time they open the app.')
    } catch (e) {
      toast.error('Couldn’t save', /content/.test(e?.message ?? '')
        ? 'The database needs migration 73 first (see DEPLOYMENT.md).'
        : friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle icon={Megaphone} subtitle="A bar at the top of every screen">Notice bar</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(notice.enabled)}
              onChange={(e) => setNotice((n) => ({ ...n, enabled: e.target.checked }))}
            />
            <span className="text-body text-primary-token font-medium">Show the notice</span>
          </label>
          <AppTextarea
            label="Message"
            rows={2}
            maxLength={200}
            placeholder="e.g. Janmashtami festival schedule is now available"
            value={notice.text ?? ''}
            onChange={(e) => setNotice((n) => ({ ...n, text: e.target.value }))}
            error={errors.noticeText}
            hint={`${(notice.text ?? '').length}/200`}
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <AppSelect label="Style" value={notice.tone} onChange={(e) => setNotice((n) => ({ ...n, tone: e.target.value }))}>
              <option value="info">Information (blue)</option>
              <option value="success">Good news (green)</option>
              <option value="warning">Important (orange)</option>
              <option value="danger">Urgent (red)</option>
            </AppSelect>
            <label className="flex items-center gap-3 cursor-pointer sm:pt-8">
              <input
                type="checkbox"
                checked={notice.dismissible !== false}
                onChange={(e) => setNotice((n) => ({ ...n, dismissible: e.target.checked }))}
              />
              <span className="text-body text-primary-token">Members can close it</span>
            </label>
            <AppInput
              label="Link (optional)"
              type="url"
              placeholder="https://…"
              value={notice.linkUrl ?? ''}
              onChange={(e) => setNotice((n) => ({ ...n, linkUrl: e.target.value.trim() }))}
              error={errors.noticeLink}
            />
            <AppInput
              label="Link text"
              placeholder="Details"
              value={notice.linkLabel ?? ''}
              onChange={(e) => setNotice((n) => ({ ...n, linkLabel: e.target.value }))}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={LifeBuoy} subtitle="Shown on help and maintenance screens">Support contacts</CardTitle>
        </CardHeader>
        <CardBody className="grid sm:grid-cols-2 gap-4">
          <AppInput label="Phone" type="tel" inputMode="tel" value={support.phone ?? ''} onChange={(e) => setSupport((s) => ({ ...s, phone: e.target.value }))} />
          <AppInput label="WhatsApp" type="tel" inputMode="tel" value={support.whatsapp ?? ''} onChange={(e) => setSupport((s) => ({ ...s, whatsapp: e.target.value }))} />
          <AppInput label="Email" type="email" value={support.email ?? ''} onChange={(e) => setSupport((s) => ({ ...s, email: e.target.value }))} />
          <AppInput label="Hours" placeholder="e.g. 9 am – 8 pm" value={support.hours ?? ''} onChange={(e) => setSupport((s) => ({ ...s, hours: e.target.value }))} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle
            icon={Link2}
            subtitle="Website, donation page, YouTube…"
            action={
              <Button size="sm" variant="soft" icon={Plus} onClick={() => setLinks((l) => [...l, { label: '', url: '' }])}>
                Add
              </Button>
            }
          >
            Useful links
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {links.length === 0 && <p className="text-caption">No links yet.</p>}
          {links.map((link, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                <AppInput
                  placeholder="Label"
                  aria-label="Link label"
                  value={link.label}
                  onChange={(e) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
                />
                <AppInput
                  placeholder="https://…"
                  aria-label="Link address"
                  type="url"
                  value={link.url}
                  error={errors[`link${i}`]}
                  onChange={(e) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, url: e.target.value.trim() } : l)))}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove link"
                onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button icon={Save} loading={saving} onClick={save} className="w-full sm:w-auto">Save</Button>
      </div>
    </div>
  )
}
