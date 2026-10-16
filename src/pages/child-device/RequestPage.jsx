import { useState, useEffect, useCallback } from 'react'
import { Clock, Smartphone, Globe, Send, CheckCircle2, XCircle, AlertCircle, Hourglass } from 'lucide-react'
import { createRequest, listMyRequests, listRestrictedApps } from '../../lib/requestApi'
import { normalizeHost } from '../../lib/webPolicy'
import { friendlyError } from '../../lib/friendlyError'
import { ChildPage, ChildHeader, ChildCard, ChildNote, ChildPrimaryButton } from '../../components/child-device/ChildScreen.jsx'

const REQUEST_TYPES = [
  { value: 'bonus_time', label: 'More time', icon: Clock, placeholder: 'I need 30 more minutes to finish homework' },
  { value: 'app_unblock', label: 'An app', icon: Smartphone, placeholder: 'I need it for a school project' },
  { value: 'website_access', label: 'A website', icon: Globe, placeholder: 'I need it for research' },
]
const TYPE_LABEL = { bonus_time: 'More time', app_unblock: 'App', website_access: 'Website', schedule_exception: 'Routine break' }
const MINUTES = [15, 30, 60]

function requestTitle(req) {
  const m = req.metadata ?? {}
  if (req.request_type === 'bonus_time') return `${m.minutes ?? 30} more minutes`
  if (req.request_type === 'app_unblock') return m.app_name ?? 'An app'
  if (req.request_type === 'website_access') return m.domain ?? 'A website'
  return TYPE_LABEL[req.request_type] ?? 'Request'
}

const STATUS = {
  approved: { icon: CheckCircle2, cls: 'text-[var(--color-success)]', label: 'Yes' },
  denied: { icon: XCircle, cls: 'text-[var(--color-danger)]', label: 'No' },
  pending: { icon: Hourglass, cls: 'text-[var(--color-warning)]', label: 'Waiting' },
}

export default function RequestPage() {
  const [type, setType] = useState('bonus_time')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [apps, setApps] = useState([])
  const [app, setApp] = useState(null)
  const [otherApp, setOtherApp] = useState('')
  const [site, setSite] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [requests, setRequests] = useState([])

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await listMyRequests())
    } catch {
      // The history is a nice-to-have; asking still works without it.
    }
  }, [])

  useEffect(() => {
    // Deferred so setState happens after mount, not inside the effect body.
    const id = setTimeout(() => {
      loadRequests()
      listRestrictedApps().then(setApps).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [loadRequests])

  const domain = normalizeHost(site)?.replace(/^www\./, '') ?? null
  const appName = app?.appName ?? otherApp.trim()
  const ready = reason.trim() && (
    type === 'bonus_time' ||
    (type === 'app_unblock' && appName) ||
    (type === 'website_access' && domain)
  )

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!ready) return
    setSending(true)
    setError(null)
    try {
      // Structured metadata lets the parent's "Approve" make the change
      // itself (resolveChildRequest). A free-typed app name has no package,
      // so it stays a text request the parent handles by hand.
      const metadata = type === 'bonus_time'
        ? { minutes }
        : type === 'app_unblock'
          ? (app ? { package_name: app.packageName, app_name: app.appName } : { app_name: appName })
          : { domain }
      await createRequest({ type, metadata, reason: reason.trim() })
      setReason(''); setApp(null); setOtherApp(''); setSite(''); setMinutes(30)
      setSent(true)
      setTimeout(() => setSent(false), 4000)
      await loadRequests()
    } catch (err) {
      setError(friendlyError(err, 'Couldn’t send that. Check the internet and try again.'))
    } finally {
      setSending(false)
    }
  }

  const typeConfig = REQUEST_TYPES.find((t) => t.value === type) || REQUEST_TYPES[0]

  return (
    <ChildPage>
      <ChildHeader back="/child/home" title="Ask a parent" subtitle="More time, an app, or a website" />

      <main className="flex-1 px-5 py-5 space-y-4">
        <form onSubmit={handleSubmit}>
          <ChildCard className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What do you want?">
              {REQUEST_TYPES.map((t) => {
                const active = type === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { setType(t.value); setError(null) }}
                    className={`press flex flex-col items-center justify-center gap-1.5 h-20 rounded-[var(--radius-md)] border text-sm font-semibold transition-colors ${
                      active
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)]'
                        : 'border-[var(--border-color)] text-secondary-token'
                    }`}
                  >
                    <t.icon className="w-5 h-5" />
                    {t.label}
                  </button>
                )
              })}
            </div>

            {type === 'bonus_time' && (
              <div>
                <p className="text-sm font-semibold text-primary-token mb-2">How long?</p>
                <div className="flex gap-2">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinutes(m)}
                      aria-pressed={minutes === m}
                      className={`press flex-1 h-11 rounded-[var(--radius-md)] font-bold text-sm ${
                        minutes === m ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-[var(--surface-muted)] text-secondary-token'
                      }`}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>
            )}

            {type === 'app_unblock' && (
              <div>
                <p className="text-sm font-semibold text-primary-token mb-2">Which app?</p>
                {apps.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {apps.map((a) => (
                      <button
                        key={a.packageName}
                        type="button"
                        onClick={() => { setApp(app?.packageName === a.packageName ? null : a); setOtherApp('') }}
                        aria-pressed={app?.packageName === a.packageName}
                        className={`h-9 px-3.5 rounded-full text-sm font-medium border ${
                          app?.packageName === a.packageName
                            ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary-strong)]'
                            : 'border-[var(--border-color)] text-secondary-token'
                        }`}
                      >
                        {a.appName}
                      </button>
                    ))}
                  </div>
                )}
                {!app && (
                  <input
                    value={otherApp}
                    onChange={(e) => setOtherApp(e.target.value)}
                    placeholder={apps.length ? 'Or type another app’s name' : 'Type the app’s name'}
                    aria-label="App name"
                  />
                )}
              </div>
            )}

            {type === 'website_access' && (
              <div>
                <label htmlFor="req-site" className="text-sm font-semibold text-primary-token mb-2 block">Which website?</label>
                <input
                  id="req-site"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="e.g. khanacademy.org"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {site && !domain && <p className="text-xs text-[var(--color-danger)] mt-1.5">That doesn’t look like a website address.</p>}
              </div>
            )}

            <div>
              <label htmlFor="req-reason" className="text-sm font-semibold text-primary-token mb-2 block">Why?</label>
              <textarea
                id="req-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={typeConfig.placeholder}
                rows={3}
                maxLength={300}
                className="resize-none"
              />
            </div>

            {error && <ChildNote tone="danger" icon={AlertCircle}>{error}</ChildNote>}
            {sent && <ChildNote tone="success" icon={CheckCircle2}>Sent! Your parents got a notification.</ChildNote>}

            <ChildPrimaryButton type="submit" disabled={sending || !ready}>
              <Send className="w-[18px] h-[18px]" /> {sending ? 'Sending…' : 'Send'}
            </ChildPrimaryButton>
          </ChildCard>
        </form>

        {requests.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-overline px-1">Your requests</h2>
            {requests.slice(0, 20).map((req) => {
              const st = STATUS[req.status] ?? STATUS.pending
              return (
                <ChildCard key={req.id} className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-primary-token truncate">{requestTitle(req)}</p>
                    {req.reason && <p className="text-sm text-secondary-token mt-0.5 line-clamp-2">{req.reason}</p>}
                    <p className="text-xs text-muted-token mt-1">{new Date(req.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${st.cls}`}>
                    <st.icon className="w-4 h-4" /> {st.label}
                  </span>
                </ChildCard>
              )
            })}
          </section>
        )}
      </main>
    </ChildPage>
  )
}
