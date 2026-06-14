import { supabase } from '@/lib/supabase'

// Offline queue for sadhana reports.
// Reports submitted while offline are stored in localStorage and flushed to
// Supabase when connectivity returns. Upserts are idempotent
// (onConflict: profile_id,report_date), so re-syncing is always safe.

const KEY = 'skv_sadhana_queue'

export function getSadhanaQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function setQueue(queue) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue))
  } catch {
    // storage may be unavailable/full; ignore
  }
}

export function getSadhanaQueueCount() {
  return getSadhanaQueue().length
}

export function enqueueSadhanaReport(payload) {
  const queue = getSadhanaQueue()
  // De-dupe on profile_id + report_date, keeping the latest submission.
  const next = queue.filter(
    (r) => !(r.profile_id === payload.profile_id && r.report_date === payload.report_date)
  )
  next.push(payload)
  setQueue(next)
}

export async function flushSadhanaQueue() {
  const queue = getSadhanaQueue()
  if (queue.length === 0) return { synced: 0, remaining: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: 0, remaining: queue.length }
  }

  const remaining = []
  let synced = 0
  for (const payload of queue) {
    const { error } = await supabase
      .from('sadhana_reports')
      .upsert(payload, { onConflict: 'profile_id,report_date' })
    if (error) {
      remaining.push(payload) // keep for the next attempt
    } else {
      synced += 1
    }
  }
  setQueue(remaining)
  return { synced, remaining: remaining.length }
}
