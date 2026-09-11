/**
 * setupSteps.js
 *
 * The single definition of what "set up" means on a child's device, shared
 * by the one-at-a-time wizard (PermissionWizardPage) and the nagging
 * checklist on the home screen (SetupChecklistCard). Two lists that could
 * drift is how a device ends up "fully set up" in one place and "missing
 * Usage access" in the other.
 *
 * Every one of these is a grant Android requires a human to make on THIS
 * device — no app, Device Owner or not, can turn them on remotely. See
 * PLATFORM_LIMITATIONS.md.
 */

import { ShieldCheck, Eye, BarChart3, AppWindow, Bell, MapPin, BatteryCharging, Wifi } from 'lucide-react'
import { dpc } from './dpcPlugin.js'
import { hasAccessibilityAccess, openAccessibilitySettings } from './accessibilityPlugin.js'
import { hasUsageAccess, openUsageAccessSettings } from './usageStatsPlugin.js'

export const SETUP_STEPS = [
  {
    key: 'deviceAdmin',
    icon: ShieldCheck,
    label: 'Activate device admin',
    why: 'Lets VOICE lock the screen when screen time runs out, and stops the app being uninstalled.',
    action: 'Activate',
    required: true,
    check: async () => (await dpc.isDeviceOwner()).isDeviceAdmin,
    request: () => dpc.requestDeviceAdmin(),
  },
  {
    key: 'accessibility',
    icon: Eye,
    label: 'Turn on Accessibility for VOICE',
    why: 'The heart of it: this is what actually blocks apps, blocks websites and keeps the settings safe.',
    action: 'Open Accessibility settings',
    hint: 'Find VOICE in the list (often under "Downloaded apps" or "Installed services") and switch it on.',
    required: true,
    check: async () => (await hasAccessibilityAccess()).enabled,
    request: () => openAccessibilitySettings(),
  },
  {
    key: 'usage',
    icon: BarChart3,
    label: 'Allow Usage access',
    why: 'Needed to measure screen time — daily limits and per-app limits do nothing without it.',
    action: 'Open Usage access',
    hint: 'Find VOICE in the list and turn "Permit usage access" on.',
    required: true,
    check: async () => (await hasUsageAccess()).granted,
    request: () => openUsageAccessSettings(),
  },
  {
    key: 'notifications',
    icon: Bell,
    label: 'Allow notifications',
    why: 'So messages from your parents and "time is nearly up" warnings actually appear.',
    action: 'Allow',
    required: true,
    check: async () => (await dpc.hasNotificationPermission()).granted,
    request: () => dpc.requestNotificationPermission(),
  },
  {
    key: 'overlay',
    icon: AppWindow,
    label: 'Allow "Display over other apps"',
    why: 'Shows a friendly explanation when something is blocked, instead of the app just closing.',
    action: 'Allow',
    required: true,
    check: async () => (await dpc.canDrawOverlays()).granted,
    request: () => dpc.requestOverlayPermission(),
  },
  {
    key: 'location',
    icon: MapPin,
    label: 'Allow location',
    why: 'Lets your parents see where you are, and sends your position with an SOS.',
    action: 'Allow',
    required: false,
    check: async () => (await dpc.hasLocationPermission()).granted,
    request: () => dpc.requestLocationPermission(),
  },
  {
    key: 'battery',
    icon: BatteryCharging,
    label: 'Let VOICE run in the background',
    why: 'Stops Android from killing supervision to save battery — which looks exactly like tampering from your parents\u2019 side.',
    action: 'Allow',
    required: false,
    check: async () => (await dpc.isIgnoringBatteryOptimizations()).granted,
    request: () => dpc.requestIgnoreBatteryOptimizations(),
  },
  {
    key: 'vpn',
    icon: Wifi,
    label: 'Allow VPN connection',
    // Only surfaced when a parent has opted into VPN filtering — website
    // blocking and internet pause both work without it now.
    why: 'Only needed for the advanced "filter with a VPN" option your parents can turn on.',
    action: 'Allow',
    required: false,
    optIn: true,
    check: async () => (await dpc.hasVpnConsent()).granted,
    request: () => dpc.requestVpnConsent(),
  },
]

/** Resolves every step's current grant state: { [key]: boolean }. */
export async function readSetupStatus() {
  const entries = await Promise.all(
    SETUP_STEPS.map(async (step) => {
      try {
        return [step.key, !!(await step.check())]
      } catch {
        return [step.key, false]
      }
    }),
  )
  return Object.fromEntries(entries)
}

/** Steps still outstanding, required ones first. Opt-in steps are excluded unless explicitly included. */
export function outstandingSteps(status, { includeOptIn = false } = {}) {
  if (!status) return []
  return SETUP_STEPS.filter((s) => !status[s.key] && (includeOptIn || !s.optIn)).sort(
    (a, b) => Number(b.required) - Number(a.required),
  )
}

export function isSetupComplete(status) {
  if (!status) return false
  return SETUP_STEPS.every((s) => s.optIn || !s.required || status[s.key])
}
