import { useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion, CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, ChevronUp, Smartphone } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { protectionHealth, PROTECTION_STATUS_META, oemGuidance, onlineStatus } from '@/lib/protectionHealth'

const STATUS_ICON = { strong: ShieldCheck, attention: ShieldAlert, critical: ShieldOff, unknown: ShieldQuestion, inactive: ShieldQuestion }
const STATUS_RING = {
  strong: 'text-[var(--color-success)] bg-[var(--color-success-soft)]',
  attention: 'text-[var(--color-warning)] bg-[var(--color-accent-soft)]',
  critical: 'text-[var(--color-danger)] bg-[var(--color-danger-soft)]',
  unknown: 'text-muted-token bg-[var(--surface-muted)]',
  inactive: 'text-muted-token bg-[var(--surface-muted)]',
}
const ITEM_ICON = {
  ok: { Icon: CheckCircle2, cls: 'text-[var(--color-success)]', label: 'On' },
  partial: { Icon: AlertTriangle, cls: 'text-[var(--color-warning)]', label: 'Partly on' },
  missing: { Icon: XCircle, cls: 'text-[var(--color-danger)]', label: 'Off' },
  unknown: { Icon: HelpCircle, cls: 'text-muted-token', label: 'Not reported' },
}

/**
 * "Is my child actually protected right now?" — built only from what the
 * child's phone last reported, with every gap explained (why it matters,
 * what stops working, how to fix it). See src/lib/protectionHealth.js.
 */
export default function ProtectionHealthCard({ device, child, vpnRequired = false }) {
  const [open, setOpen] = useState(null)
  const health = protectionHealth(device, child, { vpnRequired })
  const meta = PROTECTION_STATUS_META[health.status]
  const StatusIcon = STATUS_ICON[health.status]
  const seen = onlineStatus(device)
  const state = device?.enforcement_state ?? {}
  const oem = oemGuidance(state.manufacturer)
  const needsOem = oem && health.items.some((i) => i.key === 'battery_optimization_exempt' && i.state !== 'ok')

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface)] p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${STATUS_RING[health.status]}`}>
          <StatusIcon className="w-6 h-6" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-primary-token">Protection</p>
            <Badge variant={meta.tone}>{meta.label}{health.score != null ? ` · ${health.score}%` : ''}</Badge>
            <Badge variant={seen.tone} dot>{seen.label}</Badge>
          </div>
          <p className="text-sm text-secondary-token mt-1">{health.headline}</p>
        </div>
      </div>

      {health.score != null && (
        <div className="h-2 rounded-full bg-[var(--surface-muted)] overflow-hidden" role="progressbar" aria-valuenow={health.score} aria-valuemin={0} aria-valuemax={100} aria-label="Protection score">
          <div
            className={`h-full rounded-full ${health.status === 'strong' ? 'bg-[var(--color-success)]' : health.status === 'attention' ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-danger)]'}`}
            style={{ width: `${health.score}%` }}
          />
        </div>
      )}

      <ul className="divide-y divide-[var(--border-color)]">
        {health.items.map((item) => {
          const { Icon, cls, label } = ITEM_ICON[item.state]
          const expandable = item.state === 'missing' || item.state === 'partial'
          const isOpen = open === item.key
          return (
            <li key={item.key} className="py-2.5">
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpen(isOpen ? null : item.key)}
                className="w-full flex items-center gap-3 text-left min-h-[40px] disabled:cursor-default"
                aria-expanded={expandable ? isOpen : undefined}
              >
                <Icon className={`w-5 h-5 shrink-0 ${cls}`} aria-hidden />
                <span className="flex-1 text-sm text-primary-token">{item.label}</span>
                <span className={`text-xs font-medium ${cls}`}>{label}</span>
                {expandable && (isOpen ? <ChevronUp className="w-4 h-4 text-muted-token" /> : <ChevronDown className="w-4 h-4 text-muted-token" />)}
              </button>
              {isOpen && (
                <div className="mt-2 ml-8 rounded-xl bg-[var(--surface-muted)] p-3 space-y-2 text-sm">
                  <p className="text-secondary-token">{item.why}</p>
                  <p className="text-secondary-token"><span className="font-semibold text-primary-token">What stops: </span>{item.stops}</p>
                  <ol className="list-decimal list-inside space-y-1 text-secondary-token">
                    {item.fix.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {needsOem && (
        <div className="rounded-xl border border-[var(--border-color)] p-3 space-y-2">
          <p className="text-sm font-semibold text-primary-token flex items-center gap-2">
            <Smartphone className="w-4 h-4" aria-hidden /> Extra steps for {oem.brand} phones
          </p>
          <p className="text-xs text-muted-token">These phones close background apps aggressively. Menu names vary a little by version.</p>
          <ol className="list-decimal list-inside space-y-1 text-sm text-secondary-token">
            {oem.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      )}

      <p className="text-xs text-muted-token">
        Strong Android supervision, without a factory reset. A determined child can still get around it with safe mode, a second user profile or a computer; VOICE alerts you whenever it detects protection going off.
      </p>
    </div>
  )
}
