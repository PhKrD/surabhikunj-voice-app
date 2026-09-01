// =====================================================================
// deviceModeStore.js — "how is THIS physical device configured?"
//
// Distinct from account role (parent/counsellor/admin/etc, enforced
// server-side via RBAC) and distinct from childDeviceState.js (which
// tracks a CHILD device's live enrollment/lock/bonus state once it is in
// child mode). This store only answers one question, persisted locally:
//
//   'unset'  — fresh install, device has not been configured for
//              Parental Control yet. The org app behaves exactly as it
//              always has; this only matters when the user opens the
//              Parental Control module.
//   'parent' — this device logs into a normal VOICE org account and uses
//              Parental Control (if at all) as a management console.
//   'child'  — this device was deliberately set up (by whoever is
//              physically holding it — normally a parent, briefly, during
//              setup) to be a supervised child device. Once set, the app
//              ALWAYS boots straight into the child experience and never
//              shows the org login screen again on this device, until an
//              explicit reset.
//
// SECURITY NOTE: this flag is a LOCAL UX ROUTING HINT ONLY. It decides
// which screen the app shows first; it grants no privilege by itself.
// Every actual parental-control read/write is authorized server-side by
// pc_is_parent_of() / pc_is_device_auth() RLS policies (see
// supabase/52_parental_control_schema.sql, 61_policy_integrity.sql) —
// flipping this value in localStorage does not let a child device read
// another family's data or a parent device bypass device-owner checks.
// =====================================================================

import { create } from 'zustand'
import { clearDeviceCreds } from '@/lib/deviceStore.js'

const KEY = 'voice_device_mode'

function loadMode() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'parent' || raw === 'child' ? raw : 'unset'
  } catch {
    return 'unset'
  }
}

export const useDeviceModeStore = create((set) => ({
  mode: loadMode(),

  setMode: (mode) => {
    if (mode !== 'parent' && mode !== 'child' && mode !== 'unset') return
    try {
      if (mode === 'unset') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, mode)
    } catch {
      /* localStorage unavailable — state still updates for this session */
    }
    set({ mode })
  },

  /** Secure reconfiguration: clears the device-mode flag AND any child
   * device credentials so a device can be freshly re-set-up. Does not
   * touch org auth (that's a separate supabase.auth.signOut() call by
   * the caller if appropriate). */
  reset: () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    clearDeviceCreds()
    set({ mode: 'unset' })
  },
}))
