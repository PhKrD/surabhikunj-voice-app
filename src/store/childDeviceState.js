/**
 * deviceState.js — Zustand store for runtime device state.
 *
 * Keeps track of:
 *   enrolled     - whether this device has been paired with a child profile
 *   childName    - display name of the child (shown on home screen)
 *   isLocked     - true when the device is in a blocking schedule / routine,
 *                  a restricted time, over today's limit, or parent-locked
 *   lockReason   - why (screenTimePolicy.js LOCK_REASON_COPY key) — set from
 *                  the native engine's snapshot, see useEnforcementSnapshot
 *   lockLabel    - human label (schedule name) for the lock screen
 *   screenTime   - { usedMin, limitMin } today, from the native engine
 *   bonusActive  - true when a bonus time grant is currently valid
 *   pendingSOS   - true while a SOS is being sent
 */

import { create } from 'zustand'
import { loadDeviceCreds, isEnrolled } from '../lib/deviceStore.js'
import { isBonusActive } from '../lib/commandPoller.js'

export const useDeviceState = create((set) => ({
  enrolled: isEnrolled(),
  childName: loadDeviceCreds()?.childName ?? '',
  // True when this device's session is a real VOICE org member's own
  // account (pc_children.linked_profile_id was set at pairing time) rather
  // than a throwaway device-only one — see src/lib/deviceStore.js
  // isOrgMemberDevice() and App.jsx for how this changes the whole app
  // shell shown on this device.
  isOrgMember: !!loadDeviceCreds()?.isOrgMember,
  isLocked: false,
  lockReason: null,
  lockLabel: '',
  screenTime: { usedMin: null, limitMin: null },
  bonusActive: isBonusActive(),
  pendingSOS: false,
  sosError: null,
  lastCommand: null,
  // Set when the parent removed/deactivated this device server-side.
  // Distinct from `enrolled=false` so the UI can explain WHY re-pairing is
  // needed instead of silently landing back on the enrollment screen.
  revoked: false,

  setEnrolled: (creds) =>
    set({ enrolled: true, revoked: false, childName: creds.childName ?? '', isOrgMember: !!creds.isOrgMember }),

  setRevoked: () => set({ enrolled: false, revoked: true, isLocked: false, lockReason: null }),

  setLocked: (locked, reason = locked ? 'parent_lock' : null, label = '') =>
    set({ isLocked: locked, lockReason: locked ? reason : null, lockLabel: locked ? label : '' }),

  /** Applies a native enforcement snapshot (dpc.getEnforcementSnapshot()). */
  applySnapshot: (snap) =>
    set({
      isLocked: Boolean(snap?.locked),
      lockReason: snap?.locked ? (snap.lockReason ?? 'schedule') : null,
      lockLabel: snap?.locked ? (snap.lockLabel ?? '') : '',
      screenTime: { usedMin: snap?.screenTimeTodayMin ?? null, limitMin: snap?.screenTimeLimitMin ?? null },
      bonusActive: Boolean(snap?.bonusActive) || isBonusActive(),
    }),

  setBonusActive: (active) => set({ bonusActive: active }),

  setPendingSOS: (pending) => set({ pendingSOS: pending }),

  setSosError: (err) => set({ sosError: err }),

  setLastCommand: (cmd) => set({ lastCommand: cmd }),

  refresh: () =>
    set({
      enrolled: isEnrolled(),
      bonusActive: isBonusActive(),
      childName: loadDeviceCreds()?.childName ?? '',
      isOrgMember: !!loadDeviceCreds()?.isOrgMember,
    }),
}))
