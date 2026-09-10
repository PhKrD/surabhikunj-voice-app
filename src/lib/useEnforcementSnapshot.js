/**
 * useEnforcementSnapshot.js
 * Polls the NATIVE policy engine's state (dpc.getEnforcementSnapshot()) and
 * mirrors it into childDeviceState so the child-facing UI reacts within a
 * couple of seconds to a daily limit being reached, a restricted hour
 * starting, a schedule kicking in, a parent "Lock now", or any of those
 * ending — without the JS layer re-deriving any of that itself.
 *
 * Used by the isolated child shell (ChildDeviceShell) AND the org-member
 * child mode (FamilySupervision); both call it once at their root.
 */

import { useEffect } from 'react'
import { dpc } from './dpcPlugin.js'
import { useDeviceState } from '../store/childDeviceState.js'

const POLL_MS = 3000

export function useEnforcementSnapshot(active = true) {
  const applySnapshot = useDeviceState((s) => s.applySnapshot)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    let timer = null

    const tick = async () => {
      try {
        const snap = await dpc.getEnforcementSnapshot()
        if (!cancelled && !snap?.webPlatform) applySnapshot(snap)
      } catch {
        /* native bridge unavailable — leave the last state alone */
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }

    tick()
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, applySnapshot])
}
