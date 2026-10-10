/**
 * FamilyBonusPage.jsx — Family-section equivalent of
 * src/pages/child-device/BonusTimePage.jsx, reachable at /family/bonus.
 * See FamilyHomePage.jsx.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { requestBonusTime } from '../../lib/bonusTimeApi.js'

const PRESETS = [15, 30, 45, 60]

export default function FamilyBonusPage() {
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
      await requestBonusTime({ requestedMin: minutes, reason })
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-green-50 flex flex-col items-center justify-center px-8 gap-6">
        <CheckCircle size={64} className="text-green-500" />
        <h1 className="text-2xl font-bold text-primary-token text-center">Request sent!</h1>
        <p className="text-muted-token text-center">Your parents have been notified. Wait for their approval.</p>
        <button
          onClick={() => navigate('/family', { replace: true })}
          className="mt-4 bg-[var(--color-primary-600)] text-white font-bold rounded-2xl px-8 py-4"
        >
          Back to home
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-primary-50)] flex flex-col">
      {/* Header */}
      <div className="bg-[var(--color-primary-600)] text-white px-6 pt-12 pb-6 flex items-center gap-4">
        <button onClick={() => navigate('/family')}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-bold">Request more time</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-6 px-6 py-8">
        {/* Preset buttons */}
        <div>
          <label className="text-sm font-semibold text-secondary-token mb-3 block">
            How much time do you need?
          </label>
          <div className="grid grid-cols-4 gap-3">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={`py-3 rounded-xl font-semibold text-sm transition-colors ${
                  minutes === m
                    ? 'bg-[var(--color-primary-600)] text-white'
                    : 'bg-[var(--surface)] text-secondary-token border border-[var(--border-color)]'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="text-sm font-semibold text-secondary-token mb-2 block">
            Why do you need it? <span className="text-muted-token font-normal">(optional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Homework, finishing a level…"
            rows={3}
            className="w-full border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex-1" />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)] disabled:bg-[var(--color-primary-300)] text-white font-bold rounded-2xl py-4 transition-colors"
        >
          {loading ? 'Sending…' : `Ask for ${minutes} more minutes`}
        </button>
      </form>
    </div>
  )
}
