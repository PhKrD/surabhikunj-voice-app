/**
 * SetupChecklistCard.jsx
 *
 * The persistent nag on the child device's home screen for anything from
 * SETUP_STEPS that is still missing — usually because a permission was
 * revoked later, since the wizard (PermissionWizardPage) handles first
 * setup. Both read the SAME list from src/lib/setupSteps.js so they can
 * never disagree about whether the device is set up.
 *
 * Renders nothing when everything (required and optional) is granted.
 */

import { useEffect, useState, useCallback } from 'react'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { readSetupStatus, outstandingSteps } from '../../lib/setupSteps.js'

export default function SetupChecklistCard() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)

  const refresh = useCallback(async () => setStatus(await readSetupStatus()), [])

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 0)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  if (!status) return null
  const outstanding = outstandingSteps(status)
  if (outstanding.length === 0) return null

  const missingRequired = outstanding.filter((s) => s.required).length

  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-warning-soft)] p-4">
      <div className="flex items-start gap-3 mb-3">
        <ShieldAlert size={20} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-primary-token">
            {missingRequired > 0 ? 'Setup is not finished' : 'A couple of optional things'}
          </p>
          <p className="text-xs text-secondary-token mt-0.5">
            {missingRequired > 0
              ? 'Some protection is off until these are turned on. Android needs each one tapped by hand on this device.'
              : 'These make VOICE work better, but nothing is broken without them.'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {outstanding.slice(0, 3).map(({ key, icon: Icon, label, required }) => (
          <button
            key={key}
            onClick={() => navigate('/child/setup')}
            className="press flex items-center gap-3 bg-[var(--surface)] rounded-[var(--radius-md)] px-3.5 h-12 text-left"
          >
            <Icon size={18} className="text-[var(--color-warning)] shrink-0" />
            <span className="flex-1 min-w-0 text-sm font-medium text-primary-token">
              {label} {!required && <span className="text-muted-token font-normal">(optional)</span>}
            </span>
            <ChevronRight size={16} className="text-muted-token shrink-0" />
          </button>
        ))}
        {outstanding.length > 3 && (
          <button onClick={() => navigate('/child/setup')} className="text-xs font-semibold text-[var(--color-warning)] py-1">
            + {outstanding.length - 3} more
          </button>
        )}
      </div>
    </div>
  )
}
