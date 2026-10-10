/**
 * Pure helpers for extra time, kept out of parentalControlApi.js so they can
 * be unit-tested without the Supabase client.
 */

/** ISO expiry for `minutes` more extra time on top of any still running. */
export function extendedExpiry(currentIso, minutes, now = Date.now()) {
  const current = currentIso ? new Date(currentIso).getTime() : 0
  const base = Number.isFinite(current) && current > now ? current : now
  return new Date(base + minutes * 60_000).toISOString()
}
