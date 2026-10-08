// Production crash reporting without a third-party SDK: unexpected errors are
// recorded in the `client_errors` table (see supabase/73_launch_platform.sql)
// so admins can see what broke on which app version, instead of users seeing
// a raw stack trace.
//
// Deliberately defensive: reporting must never itself throw, loop, or flood
// the database from one bad render.
import { APP_VERSION } from '@/lib/appVersion'

const MAX_PER_SESSION = 20
const seen = new Set()
let sent = 0

// Noise every browser produces that says nothing about our code.
const IGNORED = [
  /ResizeObserver loop/i,
  /Script error\.?$/i,
  /AbortError/i,
  /Load failed$/i, // Safari's name for an aborted fetch
]

function describe(error) {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? '' }
  if (typeof error === 'string') return { message: error, stack: '' }
  try {
    return { message: JSON.stringify(error)?.slice(0, 500) ?? String(error), stack: '' }
  } catch {
    return { message: String(error), stack: '' }
  }
}

export async function reportError(error, context = {}) {
  const { message, stack } = describe(error)
  if (!message || IGNORED.some((re) => re.test(message))) return
  const fingerprint = `${message}|${stack.split('\n')[1] ?? ''}`
  if (seen.has(fingerprint) || sent >= MAX_PER_SESSION) return
  seen.add(fingerprint)
  sent += 1

  console.error('[error]', error, context)
  try {
    const { supabase } = await import('@/lib/supabase')
    const { Capacitor } = await import('@capacitor/core')
    await supabase.from('client_errors').insert({
      message: message.slice(0, 1000),
      stack: stack.slice(0, 4000),
      route: window.location.pathname.slice(0, 300),
      context: context && Object.keys(context).length ? context : null,
      app_version: APP_VERSION,
      platform: Capacitor.getPlatform(),
      user_agent: navigator.userAgent.slice(0, 300),
    })
  } catch {
    // Offline or table not yet created: the console line above is enough.
  }
}

/** Installs global handlers once, at boot. */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { kind: 'window.error' })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { kind: 'unhandledrejection' })
  })
}
