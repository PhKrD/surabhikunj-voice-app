import { supabase } from '@/lib/supabase'

// Sends a WhatsApp message via the `notify-whatsapp` Edge Function.
// Requires the function to be deployed and provider secrets configured
// (see supabase/functions/README.md). Throws on error.
export async function sendWhatsApp({ to, message }) {
  const { data, error } = await supabase.functions.invoke('notify-whatsapp', {
    body: { to, message },
  })
  if (error) throw error
  return data
}

// Opens WhatsApp with a pre-filled message for the user to send themselves.
// Unlike sendWhatsApp() this needs no Business API access, no provider and no
// Meta-approved templates — it is just a deep link. Pass `to` in E.164 without
// the leading + to target a specific contact, or omit it to let the user pick.
export function shareToWhatsApp({ to, message }) {
  const text = message ?? ''
  const digits = to ? String(to).replace(/\D/g, '') : ''
  const url = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`

  // Use the native Web Share API on phones/PWAs where available and no specific
  // recipient is set — this is the smoothest experience on iOS/Android.
  if (!digits && typeof navigator !== 'undefined' && navigator.share) {
    navigator.share({ text }).catch(() => openWhatsAppLink(url))
    return
  }

  openWhatsAppLink(url)
}

function openWhatsAppLink(url) {
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)

  if (isStandalone) {
    // In a PWA, window.open is often blocked; navigate in the same window.
    window.location.href = url
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// Formats a tracker entry into the plain-text report the temple shares in
// its WhatsApp groups.
export function formatTrackerReport({ trackerName, fields, values, score, date, memberName }) {
  const lines = []
  lines.push(`*${trackerName ?? 'Report'}* — ${date}`)
  if (memberName) lines.push(memberName)
  lines.push('')

  for (const field of fields ?? []) {
    const raw = values?.[field.key]
    if (raw === undefined || raw === null || raw === '') continue
    let shown = raw
    if (field.field_type === 'boolean') shown = raw ? 'Yes' : 'No'
    else if (field.unit) shown = `${raw} ${field.unit}`
    lines.push(`${field.label}: ${shown}`)
  }

  if (score != null) {
    lines.push('')
    lines.push(`*Score: ${score}/100*`)
  }
  return lines.join('\n')
}
