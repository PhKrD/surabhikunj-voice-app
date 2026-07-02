/**
 * Offline-first database using IndexedDB for resilience
 * Falls back to local storage when Supabase is unavailable
 */

import Dexie from 'dexie'

// Create IndexedDB database
const db = new Dexie('SurabhiKunjOffline')

// Define schema
db.version(1).stores({
  profiles: 'id, email, spiritual_name, role, voice_id, updated_at',
  sadhana_reports: '++id, profile_id, date, voice_id, synced',
  voices: 'id, name, location',
  cache: 'key, data, expires_at'
})

// Cache durations
const CACHE_DURATIONS = {
  profile: 24 * 60 * 60 * 1000, // 24 hours
  voices: 7 * 24 * 60 * 60 * 1000, // 7 days
  sadhana: 60 * 60 * 1000, // 1 hour
}

/**
 * Get data with fallback chain: Memory → IndexedDB → Supabase → Error
 */
export async function getWithFallback(key, fetcher, duration = CACHE_DURATIONS.profile) {
  try {
    // 1. Check memory cache
    const memCache = memoryCache.get(key)
    if (memCache && memCache.expires > Date.now()) {
      console.log(`[offline-db] Cache hit (memory): ${key}`)
      return memCache.data
    }

    // 2. Check IndexedDB cache
    const cached = await db.cache.get(key)
    if (cached && cached.expires_at > Date.now()) {
      console.log(`[offline-db] Cache hit (IndexedDB): ${key}`)
      // Warm memory cache
      memoryCache.set(key, { data: cached.data, expires: cached.expires_at })
      return cached.data
    }

    // 3. Try to fetch fresh data
    console.log(`[offline-db] Cache miss, fetching: ${key}`)
    const data = await Promise.race([
      fetcher(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Fetch timeout')), 5000)
      )
    ])

    // 4. Store in both caches
    const expires_at = Date.now() + duration
    await db.cache.put({ key, data, expires_at })
    memoryCache.set(key, { data, expires: expires_at })
    
    return data
  } catch (error) {
    console.error(`[offline-db] Fetch failed for ${key}:`, error)
    
    // 5. Return stale cache if available
    const stale = await db.cache.get(key)
    if (stale) {
      console.log(`[offline-db] Using stale cache for ${key}`)
      return stale.data
    }
    
    throw error
  }
}

/**
 * Save profile locally and sync later
 */
export async function saveProfileOffline(profile) {
  profile.updated_at = new Date().toISOString()
  await db.profiles.put(profile)
  
  // Mark for sync
  if (navigator.onLine) {
    syncQueue.push({ type: 'profile', data: profile })
    processSync()
  }
}

/**
 * Save sadhana report offline
 */
export async function saveSadhanaOffline(report) {
  report.synced = false
  const id = await db.sadhana_reports.add(report)
  
  // Queue for sync
  syncQueue.push({ type: 'sadhana', data: { ...report, id } })
  if (navigator.onLine) processSync()
  
  return id
}

/**
 * Get all unsynced data
 */
export async function getUnsyncedData() {
  const reports = await db.sadhana_reports.where('synced').equals(false).toArray()
  return { sadhana_reports: reports }
}

/**
 * Background sync processor
 */
const syncQueue = []
let syncInProgress = false

async function processSync() {
  if (syncInProgress || !navigator.onLine) return
  syncInProgress = true
  
  try {
    while (syncQueue.length > 0) {
      const item = syncQueue.shift()
      
      try {
        // Attempt to sync with Supabase
        const { supabase } = await import('./supabase')
        
        if (item.type === 'sadhana') {
          const { error } = await supabase
            .from('sadhana_reports')
            .upsert(item.data)
          
          if (!error) {
            await db.sadhana_reports.update(item.data.id, { synced: true })
          } else {
            syncQueue.push(item) // Retry later
          }
        }
      } catch (error) {
        console.error('[offline-db] Sync failed:', error)
        syncQueue.unshift(item) // Put back at front
        break
      }
    }
  } finally {
    syncInProgress = false
  }
}

// Memory cache for ultra-fast access
const memoryCache = new Map()

// Listen for online/offline events
window.addEventListener('online', () => {
  console.log('[offline-db] Back online, starting sync')
  processSync()
})

window.addEventListener('offline', () => {
  console.log('[offline-db] Gone offline, using local cache')
})

// Periodic sync every 5 minutes
setInterval(() => {
  if (navigator.onLine) processSync()
}, 5 * 60 * 1000)

export default {
  db,
  getWithFallback,
  saveProfileOffline,
  saveSadhanaOffline,
  getUnsyncedData,
}
