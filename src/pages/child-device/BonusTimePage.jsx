/**
 * BonusTimePage.jsx
 * Child requests extra screen time from the parent.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { requestBonusTime } from '../../lib/bonusTimeApi.js'
import { friendlyError } from '../../lib/friendlyError.js'
import { ChildPage, ChildHeader, ChildCard, ChildNote, ChildPrimaryButton } from '../../components/child-device/ChildScreen.jsx'

const PRESETS = [15, 30, 45, 60]
const REASONS = ['Homework', 'Finishing a game', 'Talking to family', 'Watching something']

export default function BonusTimePage() {
  const navigate = useNavigate()
  const [minutes, setMinutes] = useState(30)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await requestBonusTime({ requestedMin: minutes, reason: reason.trim() })
      setSent(true)
    } catch (err) {
      setError(friendlyError(err, 'Couldn’t send that. Check the internet and try again.'))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <ChildPage className="items-center justify-center px-8 gap-5 text-center">
        <div className="w-20 h-20 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
          <CheckCircle2 size={40} className="text-[var(--color-success)]" />
        </div>
        <h1 className="text-2xl font-bold text-primary-token">Asked!</h1>
        <p className="text-secondary-token max-w-xs leading-relaxed">
          Your parents got a notification. If they say yes, the extra {minutes} minutes start straight away.
        </p>
        <ChildPrimaryButton type="button" className="max-w-xs mt-2" onClick={() => navigate('/child/home', { replace: true })}>
          Back to home
        </ChildPrimaryButton>
      </ChildPage>
    )
  }

  return (
    <ChildPage>
      <ChildHeader back title="Ask for more time" subtitle="A parent has to say yes" />

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 px-5 py-5">
        <ChildCard className="p-5">
          <p className="text-sm font-semibold text-primary-token mb-3">How much time?</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Minutes">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                onClick={() => setMinutes(m)}
                className={`press h-14 rounded-[var(--radius-md)] font-bold text-base transition-colors ${
                  minutes === m
                    ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[var(--shadow-2)]'
                    : 'bg-[var(--surface-muted)] text-secondary-token'
                }`}
              >
                {m}<span className="text-xs font-semibold opacity-80">m</span>
              </button>
            ))}
          </div>
        </ChildCard>

        <ChildCard className="p-5">
          <label htmlFor="bonus-reason" className="text-sm font-semibold text-primary-token mb-2 block">
            What’s it for? <span className="text-muted-token font-normal">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`h-9 px-3.5 rounded-full text-sm font-medium border transition-colors ${
                  reason === r
                    ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary-strong)]'
                    : 'border-[var(--border-color)] text-secondary-token'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            id="bonus-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Or write your own…"
            rows={2}
            maxLength={200}
            className="resize-none"
          />
          <p className="text-xs text-muted-token mt-2">A real reason gets a yes far more often.</p>
        </ChildCard>

        {error && <ChildNote tone="danger" icon={AlertCircle}>{error}</ChildNote>}

        <div className="flex-1 min-h-4" />

        <ChildPrimaryButton type="submit" disabled={loading}>
          {loading ? 'Sending…' : `Ask for ${minutes} more minutes`}
        </ChildPrimaryButton>
      </form>
    </ChildPage>
  )
}
