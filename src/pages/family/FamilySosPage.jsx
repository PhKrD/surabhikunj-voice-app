/**
 * FamilySosPage.jsx — Family-section equivalent of
 * src/pages/child-device/SosPage.jsx, reachable at /family/sos alongside
 * the rest of the org app instead of replacing it. See FamilyHomePage.jsx.
 */

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, ArrowLeft, CheckCircle } from 'lucide-react'
import { fireSOS } from '../../lib/sosApi.js'

export default function FamilySosPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('armed') // armed | sending | sent | error
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const intervalRef = useRef(null)
  const TICK_MS = 50
  const HOLD_MS = 3000
  const TICKS_TO_FULL = HOLD_MS / TICK_MS

  function startHold() {
    if (phase !== 'armed') return
    let ticks = 0
    intervalRef.current = setInterval(() => {
      ticks += 1
      const pct = Math.min((ticks / TICKS_TO_FULL) * 100, 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(intervalRef.current)
        send()
      }
    }, TICK_MS)
  }

  function endHold() {
    clearInterval(intervalRef.current)
    if (phase === 'armed') setProgress(0)
  }

  async function send() {
    setPhase('sending')
    try {
      await fireSOS()
      setPhase('sent')
    } catch (err) {
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  return (
    <div className="min-h-screen bg-red-600 flex flex-col text-white">
      {/* Back (only before sending) */}
      {phase === 'armed' && (
        <button
          onClick={() => navigate('/family')}
          className="absolute top-12 left-6 flex items-center gap-1 text-red-100"
        >
          <ArrowLeft size={20} /> Back
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">
        {phase === 'sent' ? (
          <>
            <CheckCircle size={80} className="text-white" />
            <h1 className="text-3xl font-bold text-center">Alert sent!</h1>
            <p className="text-red-100 text-center">
              Your parents have been notified and can see your location. Stay calm — help is coming.
            </p>
            <button
              onClick={() => navigate('/family', { replace: true })}
              className="mt-4 bg-white text-red-600 font-bold rounded-2xl px-8 py-4"
            >
              Go back home
            </button>
          </>
        ) : phase === 'error' ? (
          <>
            <ShieldAlert size={80} />
            <h1 className="text-2xl font-bold text-center">Could not send SOS</h1>
            <p className="text-red-200 text-sm text-center">{errorMsg}</p>
            <button
              onClick={() => { setPhase('armed'); setProgress(0) }}
              className="mt-4 bg-white text-red-600 font-bold rounded-2xl px-8 py-4"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <ShieldAlert size={72} />
            <div className="text-center">
              <h1 className="text-3xl font-bold">SOS</h1>
              <p className="text-red-200 mt-2">
                {phase === 'sending' ? 'Sending alert…' : 'Hold the button for 3 seconds to send'}
              </p>
            </div>

            {/* Hold button */}
            <div className="relative">
              {/* Progress ring */}
              <svg width={160} height={160} className="absolute inset-0 -rotate-90">
                <circle cx={80} cy={80} r={72} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={8} />
                <circle
                  cx={80} cy={80} r={72}
                  fill="none"
                  stroke="white"
                  strokeWidth={8}
                  strokeDasharray={`${2 * Math.PI * 72}`}
                  strokeDashoffset={`${2 * Math.PI * 72 * (1 - progress / 100)}`}
                  className="transition-all duration-50"
                />
              </svg>
              <button
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                disabled={phase === 'sending'}
                className="w-40 h-40 rounded-full bg-white text-red-600 font-black text-xl shadow-2xl active:scale-95 transition-transform select-none"
              >
                {phase === 'sending' ? '…' : 'HOLD'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
