/**
 * SetupChecklistCard.jsx
 *
 * Shown on the child device's home screen while any permission needed for
 * parental control to actually work is still missing. Every one of these
 * is a special-access grant Android requires a human to tap through on
 * THIS device — no app (Device Owner or not) can turn them on remotely or
 * silently. See PLATFORM_LIMITATIONS.md for the full enforcement model.
 *
 * Renders nothing once everything required is granted (Device Admin +
 * Accessibility). Overlay and VPN consent are listed as recommended but
 * not required, since app-blocking already works without them (overlay
 * only adds the "why was I kicked out" explanation screen; VPN consent is
 * only needed for the internet-pause schedule action specifically).
 */

import { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, Eye, AppWindow, Wifi, ChevronRight } from 'lucide-react'
import { dpc } from '../../lib/dpcPlugin.js'
import { hasAccessibilityAccess, openAccessibilitySettings } from '../../lib/accessibilityPlugin.js'

export default function SetupChecklistCard() {
  const [status, setStatus] = useState(null)

  const refresh = useCallback(async () => {
    const [{ isDeviceAdmin }, { enabled }, { granted: overlayGranted }, { granted: vpnGranted }] = await Promise.all([
      dpc.isDeviceOwner(),
      hasAccessibilityAccess(),
      dpc.canDrawOverlays(),
      dpc.hasVpnConsent(),
    ])
    setStatus({ deviceAdmin: isDeviceAdmin, accessibility: enabled, overlay: overlayGranted, vpn: vpnGranted })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 0)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  if (!status) return null

  const items = [
    {
      key: 'deviceAdmin',
      done: status.deviceAdmin,
      icon: ShieldCheck,
      label: 'Activate device admin',
      hint: 'Needed to lock the screen and apply rules',
      action: () => dpc.requestDeviceAdmin().then(refresh),
      required: true,
    },
    {
      key: 'accessibility',
      done: status.accessibility,
      icon: Eye,
      label: 'Enable Accessibility for VOICE',
      hint: 'Needed to block apps and track web activity',
      action: () => openAccessibilitySettings().then(refresh),
      required: true,
    },
    {
      key: 'overlay',
      done: status.overlay,
      icon: AppWindow,
      label: 'Allow "Display over other apps"',
      hint: 'Shows a message when a blocked app is closed (optional)',
      action: () => dpc.requestOverlayPermission().then(refresh),
      required: false,
    },
    {
      key: 'vpn',
      done: status.vpn,
      icon: Wifi,
      label: 'Allow VPN connection',
      hint: 'Needed only for scheduled internet-pause breaks (optional)',
      action: () => dpc.requestVpnConsent().then(refresh),
      required: false,
    },
  ]

  const outstandingRequired = items.filter((i) => i.required && !i.done)
  const outstandingOptional = items.filter((i) => !i.required && !i.done)
  if (outstandingRequired.length === 0 && outstandingOptional.length === 0) return null

  const outstanding = [...outstandingRequired, ...outstandingOptional]

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <p className="font-semibold text-amber-900 mb-1">A few taps needed to finish setup</p>
      <p className="text-xs text-amber-700 mb-3">
        Android requires each of these to be turned on by hand on this device — a parent can't do it remotely.
      </p>
      <div className="flex flex-col gap-2">
        {outstanding.map(({ key, icon: Icon, label, hint, action, required }) => (
          <button
            key={key}
            onClick={action}
            className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 text-left hover:bg-amber-100/50 transition-colors"
          >
            <Icon size={18} className="text-amber-600 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-800">
                {label} {!required && <span className="text-gray-400 font-normal">(optional)</span>}
              </span>
              <span className="block text-xs text-gray-500">{hint}</span>
            </span>
            <ChevronRight size={16} className="text-amber-400 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
