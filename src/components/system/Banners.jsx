import { useEffect, useState } from 'react'
import { Download, WifiOff, X, Info, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import useConfigStore, { useGate } from '@/store/configStore'
import useOrgStore from '@/store/orgStore'
import { openExternal } from '@/lib/native'

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

const TONES = {
  info:    { cls: 'bg-[var(--color-info-soft)] text-[var(--color-info)]', icon: Info },
  success: { cls: 'bg-[var(--color-success-soft)] text-[var(--color-success)]', icon: CheckCircle2 },
  warning: { cls: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]', icon: AlertTriangle },
  danger:  { cls: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]', icon: AlertTriangle },
  primary: { cls: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)]', icon: Info },
}

function Bar({ tone = 'info', icon, children, action, onDismiss }) {
  const t = TONES[tone] ?? TONES.info
  const Icon = icon ?? t.icon
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className={cn('flex items-center gap-2.5 px-4 py-2.5 text-[0.8125rem] font-medium', t.cls)} role="status">
        <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">{children}</div>
        {action}
        {onDismiss && (
          <button onClick={onDismiss} className="-mr-1.5 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}

/** Reminds a platform admin that everyone else is locked out right now. */
export function MaintenanceAdminBanner() {
  const on = useConfigStore((s) => Boolean(s.platform?.maintenance_enabled && s.isPlatformAdmin))
  return (
    <AnimatePresence>
      {on && (
        <Bar tone="danger">
          Maintenance mode is on — only platform admins can use the app. Turn it off in Settings → App &amp; updates.
        </Bar>
      )}
    </AnimatePresence>
  )
}

/** Connection status. Shown while offline; the app keeps its cached data. */
export function OfflineBanner() {
  const online = useOnline()
  return (
    <AnimatePresence>
      {!online && (
        <Bar tone="warning" icon={WifiOff}>
          You’re offline. Showing saved data — changes need a connection.
        </Bar>
      )}
    </AnimatePresence>
  )
}

/** "A newer version of the app is available" — dismissible. */
export function UpdateBanner() {
  const gate = useGate()
  const url = useConfigStore((s) => s.platform?.apk_download_url)
  const dismiss = useConfigStore((s) => s.dismissRecommended)
  return (
    <AnimatePresence>
      {gate.recommended && url && (
        <Bar
          tone="primary"
          icon={Download}
          onDismiss={dismiss}
          action={
            <button onClick={() => openExternal(url)} className="font-semibold underline underline-offset-2 whitespace-nowrap">
              Update
            </button>
          }
        >
          A new version of the app is available.
        </Bar>
      )}
    </AnimatePresence>
  )
}

const NOTICE_DISMISS_KEY = 'org_notice_dismissed'

/** Admin-controlled notice (Settings → Organization → Notice bar). */
export function NoticeBanner() {
  const notice = useOrgStore((s) => s.settings?.content?.notice)
  const noticeKey = notice ? (notice.id || notice.text) : null
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(NOTICE_DISMISS_KEY))
  const visible = Boolean(notice?.enabled && notice?.text && dismissed !== noticeKey)

  const dismiss = () => {
    localStorage.setItem(NOTICE_DISMISS_KEY, noticeKey)
    setDismissed(noticeKey)
  }

  return (
    <AnimatePresence>
      {visible && (
        <Bar
          tone={notice.tone ?? 'info'}
          onDismiss={notice.dismissible === false ? undefined : dismiss}
          action={
            notice.linkUrl && /^https:\/\//i.test(notice.linkUrl) ? (
              <button
                onClick={() => openExternal(notice.linkUrl)}
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 whitespace-nowrap"
              >
                {notice.linkLabel || 'Open'}
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : null
          }
        >
          {notice.text}
        </Bar>
      )}
    </AnimatePresence>
  )
}
