// =====================================================================
// protectionHealth.js — what is actually protecting this child right now.
//
// Built only from what the child's phone itself last REPORTED
// (pc_devices.enforcement_state, written by PolicyEnforcer.kt) plus how old
// that report is. Nothing is green because a database flag says so: a
// permission the phone never reported, or a report too old to trust, is
// "unknown" — shown grey, never as protected.
//
// Pure + dependency-free → unit-tested with `node --test`.
// =====================================================================

/** A report older than this is too stale to vouch for anything. */
export const REPORT_STALE_MS = 30 * 60_000

// weight = how much of real-world protection depends on it (sums to 100).
const ITEMS = [
  {
    key: 'accessibility_enabled',
    label: 'Accessibility',
    weight: 35,
    why: 'This is what blocks apps, runs routines and filters websites.',
    stops: 'App blocking, routines, bedtime, website filtering and browsing history stop working.',
    fix: ['On the child\u2019s phone open VOICE.', 'Tap "Turn on Accessibility" and switch VOICE on.'],
  },
  {
    key: 'usage_access',
    label: 'App usage access',
    weight: 20,
    why: 'Needed to measure screen time.',
    stops: 'Daily limits, app time limits and usage reports stop working.',
    fix: ['On the child\u2019s phone open VOICE.', 'Tap "Allow usage access" and switch VOICE on.'],
  },
  {
    key: 'device_admin',
    label: 'Device admin',
    weight: 15,
    why: 'Lets VOICE lock the screen and protects VOICE from being removed easily.',
    stops: '"Lock now" can\u2019t turn the screen off, and remote wipe is unavailable.',
    fix: ['On the child\u2019s phone open VOICE.', 'Tap "Activate device admin" and confirm.'],
  },
  {
    key: 'battery_optimization_exempt',
    label: 'Background operation',
    weight: 10,
    why: 'Stops the phone\u2019s battery saver from closing VOICE in the background.',
    stops: 'Supervision can pause for hours at a time, especially on Xiaomi, Vivo, Oppo, Realme and OnePlus phones.',
    fix: ['On the child\u2019s phone open VOICE.', 'Tap "Allow background activity" and choose Allow.'],
  },
  {
    key: 'location_permission',
    label: 'Location',
    weight: 8,
    why: 'Shows where your child is and powers place alerts.',
    stops: 'Location and "arrived / left" alerts stop.',
    fix: ['On the child\u2019s phone: Settings \u2192 Apps \u2192 VOICE \u2192 Permissions \u2192 Location.', 'Choose "Allow all the time".'],
    // 'always' = full; 'while_in_use' = partial
    value: (s) => (s.location_permission == null ? null : s.location_permission === 'always' ? true : s.location_permission === 'while_in_use' ? 'partial' : false),
  },
  {
    key: 'notifications_allowed',
    label: 'Notifications',
    weight: 4,
    why: 'Lets VOICE warn your child before time runs out.',
    stops: 'Your child gets no "5 minutes left" warning; protection itself keeps working.',
    fix: ['On the child\u2019s phone: Settings \u2192 Apps \u2192 VOICE \u2192 Notifications \u2192 On.'],
  },
  {
    key: 'overlay_granted',
    label: 'Display over other apps',
    weight: 3,
    why: 'Fallback for showing the block screen on phones that restrict it.',
    stops: 'On some phones a blocked app just closes, without the explanation screen.',
    fix: ['On the child\u2019s phone open VOICE.', 'Tap "Allow display over other apps" and switch VOICE on.'],
  },
  {
    key: 'settings_protected',
    label: 'Protection PIN',
    weight: 5,
    why: 'Asks for your PIN before Settings screens that could switch VOICE off.',
    stops: 'Your child can turn supervision off from Settings without being stopped (you would still be alerted).',
    fix: ['In VOICE on your phone: this child \u2192 Devices \u2192 Protection PIN.'],
    value: (_s, child) => (child ? Boolean(child.parent_pin_hash) : null),
  },
]

/** Web protection only counts when the parent relies on it. */
const VPN_ITEM = {
  key: 'vpn_consent',
  label: 'Web protection (VPN)',
  why: 'Needed for Safe Search and for filtering websites inside other apps.',
  stops: 'Safe Search and in-app website filtering stop. Browser filtering still works.',
  fix: ['On the child\u2019s phone open VOICE.', 'Tap "Turn on web protection" and allow the VPN request.'],
}

function itemValue(item, state, child) {
  if (item.value) return item.value(state, child)
  const v = state?.[item.key]
  return v === true ? true : v === false ? false : null
}

/**
 * @returns {{
 *   status: 'strong'|'attention'|'critical'|'inactive'|'unknown',
 *   score: number|null,
 *   reportAgeMs: number|null,
 *   items: Array<{key,label,state:'ok'|'partial'|'missing'|'unknown',why,stops,fix}>,
 *   missing: Array, headline: string
 * }}
 */
export function protectionHealth(device, child = null, { now = Date.now(), vpnRequired = false } = {}) {
  const state = device?.enforcement_state ?? null
  const reportedAt = device?.last_enforcement_at ? new Date(device.last_enforcement_at).getTime() : NaN
  const reportAgeMs = Number.isFinite(reportedAt) ? Math.max(0, now - reportedAt) : null
  const fresh = state && reportAgeMs !== null && reportAgeMs < REPORT_STALE_MS

  const defs = vpnRequired ? [...ITEMS, { ...VPN_ITEM, weight: 10 }] : ITEMS
  const items = defs.map((def) => {
    // The PIN is the parent's own setting, known regardless of the report.
    const v = def.key === 'settings_protected' || fresh ? itemValue(def, state ?? {}, child) : null
    const s = v === true ? 'ok' : v === 'partial' ? 'partial' : v === false ? 'missing' : 'unknown'
    return { key: def.key, label: def.label, weight: def.weight, state: s, why: def.why, stops: def.stops, fix: def.fix }
  })

  if (!fresh) {
    return {
      status: state ? 'unknown' : 'inactive',
      score: null,
      reportAgeMs,
      items,
      missing: [],
      headline: state
        ? 'No recent report from this phone \u2014 protection can\u2019t be confirmed right now.'
        : 'This phone hasn\u2019t reported in yet. Open VOICE on it to finish setup.',
    }
  }

  const total = items.reduce((n, i) => n + i.weight, 0)
  const earned = items.reduce((n, i) => n + (i.state === 'ok' ? i.weight : i.state === 'partial' ? i.weight / 2 : 0), 0)
  const score = Math.round((earned / total) * 100)
  const missing = items.filter((i) => i.state === 'missing' || i.state === 'partial')
  const core = items.find((i) => i.key === 'accessibility_enabled')
  // "Strong" also needs every high-impact item (weight ≥ 10) fully on: a
  // phone whose battery saver can close VOICE is not strongly protected,
  // however the arithmetic works out.
  const highImpactGap = missing.some((i) => i.weight >= 10)
  const status = core?.state === 'missing'
    ? 'critical'
    : score >= 85 && !highImpactGap ? 'strong' : score >= 60 ? 'attention' : 'critical'
  const headline = status === 'strong'
    ? 'Strong Android supervision is active.'
    : core?.state === 'missing'
      ? 'Supervision is OFF: Accessibility is turned off on this phone.'
      : `${missing.length} setting${missing.length === 1 ? '' : 's'} need attention.`
  return { status, score, reportAgeMs, items, missing, headline }
}

export const PROTECTION_STATUS_META = Object.freeze({
  strong: { label: 'Strong', tone: 'tulasi' },
  attention: { label: 'Needs attention', tone: 'saffron' },
  critical: { label: 'Critical', tone: 'danger' },
  unknown: { label: 'Not confirmed', tone: 'default' },
  inactive: { label: 'Not set up', tone: 'default' },
})

/**
 * Manufacturer-specific steps that keep VOICE alive in the background.
 * These are guidance (menu names vary by OS version); VOICE never
 * deep-links into OEM screens that may not exist.
 */
export function oemGuidance(manufacturer) {
  const m = String(manufacturer ?? '').toLowerCase()
  if (/xiaomi|redmi|poco/.test(m)) {
    return {
      brand: 'Xiaomi / Redmi / POCO',
      steps: [
        'Settings \u2192 Apps \u2192 Manage apps \u2192 VOICE \u2192 Autostart: On.',
        'Same screen \u2192 Battery saver \u2192 No restrictions.',
        'Open Recent apps, long-press VOICE and tap the lock icon so it isn\u2019t cleared.',
      ],
    }
  }
  if (/vivo|iqoo/.test(m)) {
    return {
      brand: 'Vivo / iQOO',
      steps: [
        'Settings \u2192 Battery \u2192 Background power consumption \u2192 VOICE \u2192 Allow.',
        'i Manager \u2192 App manager \u2192 Autostart manager \u2192 VOICE: On.',
        'Lock VOICE in Recent apps (pull the card down).',
      ],
    }
  }
  if (/oppo|realme/.test(m)) {
    return {
      brand: m.includes('realme') ? 'Realme' : 'Oppo',
      steps: [
        'Settings \u2192 Apps \u2192 App management \u2192 VOICE \u2192 Battery usage \u2192 Allow background activity + Allow auto launch.',
        'Lock VOICE in Recent apps.',
      ],
    }
  }
  if (/oneplus/.test(m)) {
    return {
      brand: 'OnePlus',
      steps: [
        'Settings \u2192 Apps \u2192 VOICE \u2192 Battery \u2192 Unrestricted (or "Don\u2019t optimise").',
        'Lock VOICE in Recent apps.',
      ],
    }
  }
  if (/samsung/.test(m)) {
    return {
      brand: 'Samsung',
      steps: [
        'Settings \u2192 Apps \u2192 VOICE \u2192 Battery \u2192 Unrestricted.',
        'Settings \u2192 Battery \u2192 Background usage limits: make sure VOICE is not in "Sleeping" or "Deep sleeping" apps.',
      ],
    }
  }
  return null
}

/** "Online now" / "Last seen 8 min ago" / "Offline for 3 h" with a tone. */
export function onlineStatus(device, now = Date.now()) {
  const t = device?.last_seen_at ? new Date(device.last_seen_at).getTime() : NaN
  if (!Number.isFinite(t)) return { tone: 'default', label: 'Never connected' }
  const min = Math.max(0, Math.round((now - t) / 60_000))
  if (min < 3) return { tone: 'tulasi', label: 'Online now' }
  if (min < 60) return { tone: 'saffron', label: `Last seen ${min} min ago` }
  const h = Math.round(min / 60)
  if (h < 48) return { tone: 'danger', label: `Offline for ${h} h` }
  return { tone: 'danger', label: `Offline for ${Math.round(h / 24)} days` }
}
