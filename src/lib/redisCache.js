/**
 * Redis cache via Upstash for distributed caching
 * Sign up free at https://upstash.com (10K requests/day free)
 */

const UPSTASH_URL = import.meta.env.VITE_UPSTASH_REDIS_URL
const UPSTASH_TOKEN = import.meta.env.VITE_UPSTASH_REDIS_TOKEN

class RedisCache {
  constructor() {
    this.enabled = !!(UPSTASH_URL && UPSTASH_TOKEN)
    if (!this.enabled) {
      console.log('[redis-cache] Disabled - no Upstash credentials')
    }
  }

  async get(key) {
    if (!this.enabled) return null
    
    try {
      const response = await fetch(`${UPSTASH_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      })
      
      if (!response.ok) return null
      
      const { result } = await response.json()
      return result ? JSON.parse(result) : null
    } catch (error) {
      console.error('[redis-cache] Get failed:', error)
      return null
    }
  }

  async set(key, value, expirySeconds = 3600) {
    if (!this.enabled) return false
    
    try {
      const response = await fetch(`${UPSTASH_URL}/set/${key}`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          value: JSON.stringify(value),
          ex: expirySeconds
        })
      })
      
      return response.ok
    } catch (error) {
      console.error('[redis-cache] Set failed:', error)
      return false
    }
  }

  async delete(key) {
    if (!this.enabled) return false
    
    try {
      const response = await fetch(`${UPSTASH_URL}/del/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      })
      
      return response.ok
    } catch (error) {
      console.error('[redis-cache] Delete failed:', error)
      return false
    }
  }
}

export const redisCache = new RedisCache()

/**
 * Multi-tier cache with Redis → IndexedDB → Supabase
 */
export async function getWithRedisCache(key, fetcher, ttl = 3600) {
  // Try Redis first
  const cached = await redisCache.get(key)
  if (cached) {
    console.log(`[redis-cache] Hit: ${key}`)
    return cached
  }
  
  // Fallback to fetcher
  try {
    const data = await fetcher()
    
    // Cache in Redis for other users/devices
    await redisCache.set(key, data, ttl)
    
    return data
  } catch (error) {
    console.error(`[redis-cache] Fetch failed for ${key}:`, error)
    throw error
  }
}
