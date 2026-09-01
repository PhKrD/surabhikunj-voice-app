/**
 * deviceState.js — Zustand store for runtime device state.
 *
 * Keeps track of:
 *   enrolled     - whether this device has been paired with a child profile
 *   childName    - display name of the child (shown on home screen)
 *   isLocked     - true when the device is in a blocking schedule / routine
 *   bonusActive  - true when a bonus time grant is currently valid
 *   pendingSOS   - true while a SOS is being sent
 */

import { create } from 'zustand'
import { loadDeviceCreds, isEnrolled } from '../lib/deviceStore.js'
import { isBonusActive } from '../lib/commandPoller.js'

export const useDeviceState = create((set) => ({
  enrolled: isEnrolled(),
  childName: loadDeviceCreds()?.childName ?? '',
  isLocked: false,
  bonusActive: isBonusActive(),
  pendingSOS: false,
  sosError: null,
  lastCommand: null,
  // Set when the parent removed/deactivated this device server-side.
  // Distinct from `enrolled=false` so the UI can explain WHY re-pairing is
  // needed instead of silently landing back on the enrollment screen.
  revoked: false,

  setEnrolled: (creds) =>
    set({ enrolled: true, revoked: false, childName: creds.childName ?? '' }),

  setRevoked: () => set({ enrolled: false, revoked: true, isLocked: false }),

  setLocked: (locked) => set({ isLocked: locked }),

  setBonusActive: (active) => set({ bonusActive: active }),

  setPendingSOS: (pending) => set({ pendingSOS: pending }),

  setSosError: (err) => set({ sosError: err }),

  setLastCommand: (cmd) => set({ lastCommand: cmd }),

  refresh: () =>
    set({
      enrolled: isEnrolled(),
      bonusActive: isBonusActive(),
      childName: loadDeviceCreds()?.childName ?? '',
    }),
}))
