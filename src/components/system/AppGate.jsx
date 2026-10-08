import { Download, Wrench, RefreshCw } from 'lucide-react'
import useConfigStore, { selectGate } from '@/store/configStore'
import useOrgStore from '@/store/orgStore'
import { useDeviceModeStore } from '@/store/deviceModeStore'
import { useDeviceState } from '@/store/childDeviceState'
import { openExternal } from '@/lib/native'
import Button from '@/components/ui/Button'

function FullScreenMessage({ icon: Icon, tone = 'primary', title, message, children }) {
  const toneCls = tone === 'warning'
    ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
    : 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
  return (
    <div className="min-h-svh app-bg flex items-center justify-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm text-center">
        <div className={`w-16 h-16 rounded-[var(--radius-lg)] mx-auto flex items-center justify-center ${toneCls}`}>
          <Icon className="w-8 h-8" aria-hidden="true" />
        </div>
        <h1 className="text-title text-primary-token mt-6">{title}</h1>
        <p className="text-body text-secondary-token mt-2 whitespace-pre-line">{message}</p>
        <div className="mt-8 space-y-3">{children}</div>
      </div>
    </div>
  )
}

/**
 * Blocks the app only when the server says it must: maintenance mode, or an
 * installed APK older than the minimum supported build. Everything else
 * renders normally. Both states are lifted remotely — no reinstall needed
 * for maintenance; the update screen links straight to the new APK.
 */
export default function AppGate({ children }) {
  const gate = useConfigStore(selectGate)
  const platform = useConfigStore((s) => s.platform)
  const native = useConfigStore((s) => s.native)
  const reload = useConfigStore((s) => s.load)
  const support = useOrgStore((s) => s.settings?.content?.support)
  const deviceMode = useDeviceModeStore((s) => s.mode)
  const isOrgMember = useDeviceState((s) => s.isOrgMember)
  const isolatedChild = deviceMode === 'child' && !isOrgMember

  // A supervised child's device must always show its lock screen and SOS
  // button; enforcement is native and does not depend on this UI.
  if (isolatedChild) return children

  if (gate.status === 'maintenance') {
    return (
      <FullScreenMessage
        icon={Wrench}
        tone="warning"
        title="We’ll be right back"
        message={platform?.maintenance_message || 'The app is being updated. Please try again in a little while.'}
      >
        <Button variant="secondary" icon={RefreshCw} className="w-full" onClick={() => reload({ force: true })}>
          Check again
        </Button>
        {support?.phone && <p className="text-caption">Need help? Call {support.phone}</p>}
      </FullScreenMessage>
    )
  }

  if (gate.status === 'update_required') {
    return (
      <FullScreenMessage
        icon={Download}
        title="Please update the app"
        message={platform?.update_message || 'This version is no longer supported. Install the latest version to continue — your data stays safe.'}
      >
        {platform?.apk_download_url && (
          <Button size="lg" icon={Download} className="w-full" onClick={() => openExternal(platform.apk_download_url)}>
            Download update
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={() => reload({ force: true })}>
          I’ve updated — check again
        </Button>
        <p className="text-caption">
          Installed build {native.versionCode ?? '—'} · required {platform?.min_native_version_code}
        </p>
      </FullScreenMessage>
    )
  }

  return children
}
