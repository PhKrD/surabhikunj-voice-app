/**
 * LockedPage.jsx
 * Full-screen overlay shown when the device is in a blocking schedule/routine
 * or the parent issued a lock_device command.
 *
 * In Device Owner mode (Step 3) the DPC will actually prevent the user from
 * leaving this by suspending other apps. In the interim, this screen is
 * displayed by the web layer and back-navigation is disabled.
 */

import { Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeviceState } from '../../store/childDeviceState.js'
import { startCommandPoller } from '../../lib/commandPoller.js'
import { useEffect } from 'react'

export default function LockedPage() {
  const navigate = useNavigate()
  const { setLastCommand } = useDeviceState()

  // Keep listening — parent may unlock or resume the device
  useEffect(() => {
    startCommandPoller((cmd) => {
      setLastCommand(cmd)
      // Navigate home when the parent explicitly unlocks or resumes
      if (['unlock_device', 'resume_internet', 'sync_rules'].includes(cmd.command_type)) {
        navigate('/child/home', { replace: true })
      }
    })
  }, [navigate, setLastCommand])

  // Block back button
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); history.pushState(null, '', location.href) }
    window.addEventListener('popstate', handler)
    history.pushState(null, '', location.href)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-8 gap-8 text-white">
      <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
        <Clock size={48} className="text-indigo-400" />
      </div>

      <div className="text-center">
        <h1 className="text-3xl font-bold">Screen time paused</h1>
        <p className="text-gray-400 mt-3">
          Your parents have scheduled a break. Come back later or ask for more time.
        </p>
      </div>

      {/* Only SOS is accessible during lock */}
      <button
        onClick={() => navigate('/child/sos')}
        className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl px-8 py-4 flex items-center gap-2"
      >
        SOS — I need help
      </button>

      <p className="text-xs text-gray-600 text-center mt-4">
        The SOS button is always available for emergencies.
      </p>
    </div>
  )
}
