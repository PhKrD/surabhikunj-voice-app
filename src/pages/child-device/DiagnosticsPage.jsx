/**
 * Hidden supervision diagnostics for real-device testing (tap the name on
 * the child home screen 7 times). Read-only: shows what the native engine
 * is doing right now so a tester can tell "not enforced" from "enforced but
 * the UI is stale". Contains no tokens or personal data.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { dpc } from '@/lib/dpcPlugin.js'

const ago = (ms, now) => {
  if (!ms) return 'never'
  const s = Math.round((now - ms) / 1000)
  if (s < 0) return `in ${Math.round(-s / 60)} min`
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}
const at = (ms) => (ms ? new Date(ms).toLocaleTimeString() : '—')
const yes = (v) => (v === true ? '✅ yes' : v === false ? '❌ no' : '—')

export default function DiagnosticsPage() {
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => dpc.getDiagnostics().then((r) => alive && setD(r ? { ...r, readAt: Date.now() } : { unavailable: true }))
    load()
    const id = setInterval(load, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [tick])

  const now = d?.readAt ?? 0
  const rows = d && !d.unavailable ? [
    ['Permissions', null],
    ['Accessibility', yes(d.accessibilityEnabled)],
    ['Accessibility connected', ago(d.accessibilityConnectedAt, now)],
    ['Usage access', yes(d.usageAccess)],
    ['Device admin', yes(d.deviceAdmin)],
    ['Device owner (advanced)', yes(d.deviceOwner)],
    ['VPN consent', yes(d.vpnConsent)],
    ['Overlay', yes(d.overlay)],
    ['Battery exemption', yes(d.batteryExempt)],
    ['Notifications', yes(d.notifications)],
    ['Engine', null],
    ['Foreground service', d.foregroundServiceType || 'not running'],
    ['Service refused at', at(d.foregroundServiceRefusedAt)],
    ['Last evaluation', ago(d.lastEvaluationAt, now)],
    ['Last online sync', ago(d.lastOnlineAt, now)],
    ['Policy source', d.policySource],
    ['Own native session', yes(d.independentSession)],
    ['Session invalid since', at(d.sessionInvalidSince)],
    ['Queued reports', String(d.queuedReports)],
    ['Essential apps known', String(d.essentialApps)],
    ['Right now', null],
    ['Foreground app', d.foregroundApp ? `${d.foregroundApp} (${ago(d.foregroundAppAt, now)})` : '—'],
    ['Restriction', d.lockReason ? `${d.lockReason}${d.lockLabel ? ` · ${d.lockLabel}` : ''}` : 'none'],
    ['Restriction ends', at(d.lockUntil)],
    ['Parent lock', yes(d.parentLock)],
    ['Internet paused', yes(d.internetPaused)],
    ['Extra time until', d.bonusExpiresAt > now ? at(d.bonusExpiresAt) : '—'],
    ['Blocked apps', String(d.blockedPackages)],
    ['Screen time today', d.screenTimeTodayMin >= 0 ? `${d.screenTimeTodayMin} / ${d.screenTimeLimitMin >= 0 ? d.screenTimeLimitMin : '∞'} min` : 'no usage access'],
    ['Web filter VPN running', yes(d.vpnFilterRunning)],
    ['VPN revoked at', at(d.vpnRevokedAt)],
    ['Last command', d.lastCommand ? `${d.lastCommand} (${ago(d.lastCommandAt, now)})` : '—'],
    ['Last location sent', ago(d.lastLocationAt, now)],
  ] : []

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] p-4 pb-10">
      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={() => navigate(-1)} className="w-11 h-11 rounded-xl flex items-center justify-center bg-[var(--surface)]" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold flex-1">Supervision diagnostics</h1>
        <button type="button" onClick={() => { dpc.enforceNow({ full: true }).catch(() => {}); setTick((t) => t + 1) }} className="w-11 h-11 rounded-xl flex items-center justify-center bg-[var(--surface)]" aria-label="Sync now">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>
      {!d && <p className="text-sm text-muted-token">Loading…</p>}
      {d?.unavailable && <p className="text-sm text-muted-token">Diagnostics need the latest VOICE app on an Android phone.</p>}
      <div className="rounded-2xl bg-[var(--surface)] divide-y divide-[var(--border-color)]">
        {rows.map(([k, v]) => (v === null
          ? <p key={k} className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-token">{k}</p>
          : (
            <div key={k} className="px-4 py-2.5 flex justify-between gap-3 text-sm">
              <span className="text-secondary-token">{k}</span>
              <span className="text-primary-token text-right break-all">{v}</span>
            </div>
          )))}
      </div>
    </div>
  )
}
