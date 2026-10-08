import { useState } from 'react'
import { Smartphone, Wrench, Save, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendlyError'
import { APP_VERSION } from '@/lib/appVersion'
import useConfigStore from '@/store/configStore'
import useToastStore from '@/store/toastStore'
import { confirm } from '@/store/dialogStore'
import Card, { CardHeader, CardBody, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { AppInput, AppTextarea } from '@/components/ui/Field'

/**
 * Platform admins: app-version gating and maintenance mode
 * (app_platform_config, migration 73). Takes effect on every installed app
 * within minutes, without a release.
 */
export default function PlatformSettingsTab() {
  const platform = useConfigStore((s) => s.platform) ?? {}
  const native = useConfigStore((s) => s.native)
  const reload = useConfigStore((s) => s.load)
  const toast = useToastStore()
  const [form, setForm] = useState({
    min_native_version_code: platform.min_native_version_code ?? 0,
    recommended_native_version_code: platform.recommended_native_version_code ?? 0,
    apk_download_url: platform.apk_download_url ?? '',
    update_message: platform.update_message ?? '',
    maintenance_enabled: Boolean(platform.maintenance_enabled),
    maintenance_message: platform.maintenance_message ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = async () => {
    const min = parseInt(form.min_native_version_code, 10) || 0
    const rec = parseInt(form.recommended_native_version_code, 10) || 0
    if (form.apk_download_url && !/^https:\/\//i.test(form.apk_download_url)) {
      toast.error('The download link must start with https://')
      return
    }
    if ((min || rec) && !form.apk_download_url) {
      toast.error('Add the APK download link', 'Otherwise people asked to update have nowhere to get it.')
      return
    }
    if (form.maintenance_enabled && !platform.maintenance_enabled) {
      const ok = await confirm({
        title: 'Turn on maintenance mode?',
        message: 'Everyone except platform admins will see the maintenance screen until you turn it off here.',
        confirmLabel: 'Turn on',
        danger: true,
      })
      if (!ok) return
    }
    if (min > (native.versionCode ?? Infinity)) {
      const ok = await confirm({
        title: 'This device is older than the new minimum',
        message: `This phone has build ${native.versionCode}. After saving it will be asked to update too.`,
        confirmLabel: 'Save anyway',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('app_platform_config')
        .update({
          min_native_version_code: min,
          recommended_native_version_code: Math.max(rec, min),
          apk_download_url: form.apk_download_url.trim() || null,
          update_message: form.update_message.trim() || null,
          maintenance_enabled: form.maintenance_enabled,
          maintenance_message: form.maintenance_message.trim() || null,
        })
        .eq('id', 1)
      if (error) throw error
      await reload({ force: true })
      toast.success('Saved', 'Installed apps pick this up within a few minutes.')
    } catch (e) {
      toast.error('Couldn’t save', friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card variant="muted" className="p-4 flex gap-3">
        <Info className="w-5 h-5 text-[var(--color-info)] flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-caption">
          This device: app version <span className="font-semibold tabular">{APP_VERSION}</span>
          {native.versionCode != null && <> · APK build <span className="font-semibold tabular">{native.versionCode}</span></>}.
          Screens and features update automatically over the air; only changes to the Android app itself need a new APK.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Smartphone} subtitle="Uses the APK build number (versionCode)">App updates</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <AppInput
              label="Recommend updating below build"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.recommended_native_version_code}
              onChange={set('recommended_native_version_code')}
              hint="Shows a dismissible “new version” banner."
            />
            <AppInput
              label="Require updating below build"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.min_native_version_code}
              onChange={set('min_native_version_code')}
              hint="Blocks the app until updated. Use 0 for none."
            />
          </div>
          <AppInput
            label="APK download link"
            type="url"
            placeholder="https://…/VOICE-1.2.0.apk"
            value={form.apk_download_url}
            onChange={set('apk_download_url')}
          />
          <AppTextarea
            label="Message on the update screen (optional)"
            rows={2}
            maxLength={500}
            value={form.update_message}
            onChange={set('update_message')}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Wrench} subtitle="Temporarily closes the app for everyone">Maintenance mode</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.maintenance_enabled} onChange={set('maintenance_enabled')} />
            <span className="text-body text-primary-token font-medium">Maintenance mode is on</span>
          </label>
          <AppTextarea
            label="Message"
            rows={2}
            maxLength={500}
            placeholder="We’re upgrading the app. Back by 6 pm."
            value={form.maintenance_message}
            onChange={set('maintenance_message')}
          />
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button icon={Save} loading={saving} onClick={save} className="w-full sm:w-auto">Save</Button>
      </div>
    </div>
  )
}
