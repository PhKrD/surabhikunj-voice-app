/**
 * BonusTimePage.jsx
 * Child requests extra screen time from the parent.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { requestBonusTime } from '../../lib/bonusTimeApi.js'

const PRESETS = [15, 30, 45, 60]

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
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-8 gap-5 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle size={40} className="text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Request sent</h1>
        <p className="text-slate-500 max-w-xs leading-relaxed">
          Your parents have been notified. You&apos;ll see the extra time appear here as soon as they approve.
        </p>
        <button
          onClick={() => navigate('/child/home', { replace: true })}
          className="mt-2 w-full max-w-xs bg-indigo-600 active:bg-indigo-700 text-white font-bold rounded-2xl py-4"
        >
          Back to home
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-gradient-to-b from-indigo-600 to-indigo-700 text-white px-6 pt-14 pb-8 rounded-b-[2rem]">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-indigo-200">
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-bold mt-3">Ask for more time</h1>
        <p className="text-indigo-200 text-sm mt-1">A parent has to approve it</p>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-5 px-5 py-6">
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <label className="text-sm font-semibold text-slate-700 mb-3 block">
            How much time do you need?
          </label>
          <div className="grid grid-cols-4 gap-2.5">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={`py-3.5 rounded-2xl font-bold text-sm transition-colors ${
                  minutes === m
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <label className="text-sm font-semibold text-slate-700 mb-2 block">
            Why do you need it? <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Homework, finishing a level…"
            rows={3}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-slate-400 mt-2">A real reason gets a yes far more often.</p>
        </div>

        {error && <p className="text-sm text-red-600 px-1">{error}</p>}

        <div className="flex-1 min-h-4" />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 active:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-3xl py-4 transition-colors"
        >
          {loading ? 'Sending…' : `Ask for ${minutes} more minutes`}
        </button>
      </form>
    </div>
  )
}
