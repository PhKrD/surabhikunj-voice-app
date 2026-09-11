/**
 * SosPage.jsx
 * Full-screen SOS confirmation + send flow.
 * Hold the button to fire — long enough to prevent a pocket tap, short
 * enough for an actual emergency.
 *
 * WHY THE RING HAS pointer-events-none: the progress <svg> is absolutely
 * positioned over the button and, being a positioned element later in the
 * paint order, it hit-tested ABOVE the (statically positioned) button and
 * swallowed every touch. Pressing HOLD did literally nothing. Any overlay
 * added here must stay non-interactive for the same reason.
 */

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, ArrowLeft, CheckCircle, Loader2, PhoneCall } from 'lucide-react'
import { fireSOS } from '../../lib/sosApi.js'

const TICK_MS = 50
const HOLD_MS = 1500
const TICKS_TO_FULL = HOLD_MS / TICK_MS
const RADIUS = 76
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function SosPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('armed') // armed | sending | sent | error
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const intervalRef = useRef(null)

  useEffect(() => () => clearInterval(intervalRef.current), [])

  // `phase` is read straight from this render's closure: pointer handlers
  // are re-bound on every render, so they always see the current value.
  function startHold() {
    if (phase !== 'armed') return
    clearInterval(intervalRef.current)
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
      navigator.vibrate?.([80, 60, 80])
    } catch (err) {
      setErrorMsg(err.message)
      setPhase('error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-600 to-red-700 flex flex-col text-white">
      {phase === 'armed' && (
        <button
          onClick={() => navigate(-1)}
          className="absolute top-12 left-6 flex items-center gap-1 text-red-100 z-10"
        >
          <ArrowLeft size={20} /> Back
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">
        {phase === 'sent' ? (
          <>
            <CheckCircle size={80} />
            <h1 className="text-3xl font-bold text-center">Alert sent</h1>
            <p className="text-red-100 text-center leading-relaxed">
              Your parents have been notified and can see your location. Stay where you are if it&apos;s safe.
            </p>
            <a
              href="tel:112"
              className="w-full max-w-xs bg-white/15 border border-white/30 text-white font-semibold rounded-2xl py-4 flex items-center justify-center gap-2"
            >
              <PhoneCall size={20} /> Call emergency services
            </a>
            <button
              onClick={() => navigate('/child/home', { replace: true })}
              className="w-full max-w-xs bg-white text-red-600 font-bold rounded-2xl py-4"
            >
              Go back home
            </button>
          </>
        ) : phase === 'error' ? (
          <>
            <ShieldAlert size={80} />
            <h1 className="text-2xl font-bold text-center">Could not send SOS</h1>
            <p className="text-red-100 text-sm text-center">{errorMsg}</p>
            <a
              href="tel:112"
              className="w-full max-w-xs bg-white text-red-600 font-bold rounded-2xl py-4 flex items-center justify-center gap-2"
            >
              <PhoneCall size={20} /> Call emergency services
            </a>
            <button
              onClick={() => { setPhase('armed'); setProgress(0); setErrorMsg('') }}
              className="w-full max-w-xs bg-white/15 border border-white/30 text-white font-semibold rounded-2xl py-4"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <ShieldAlert size={64} />
            <div className="text-center">
              <h1 className="text-3xl font-bold">SOS</h1>
              <p className="text-red-100 mt-2">
                {phase === 'sending' ? 'Sending alert…' : 'Press and hold to alert your parents'}
              </p>
            </div>

            <div className="relative w-44 h-44 flex items-center justify-center">
              {/* Non-interactive by design — see the file header. */}
              <svg
                width={176}
                height={176}
                viewBox="0 0 176 176"
                className="absolute inset-0 -rotate-90 pointer-events-none"
                aria-hidden="true"
              >
                <circle cx={88} cy={88} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={8} />
                <circle
                  cx={88} cy={88} r={RADIUS}
                  fill="none"
                  stroke="white"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
                />
              </svg>
              <button
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerCancel={endHold}
                onPointerLeave={endHold}
                disabled={phase === 'sending'}
                style={{ touchAction: 'none' }}
                className="w-36 h-36 rounded-full bg-white text-red-600 font-black text-lg shadow-2xl active:bg-red-50 select-none flex items-center justify-center"
              >
                {phase === 'sending' ? <Loader2 size={32} className="animate-spin" /> : 'HOLD'}
              </button>
            </div>

            <p className="text-xs text-red-200 text-center max-w-xs">
              Only for real emergencies. Your parents get an instant notification with your location.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
