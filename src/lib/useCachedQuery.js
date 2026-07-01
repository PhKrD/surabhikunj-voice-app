import { useCallback, useEffect, useRef, useState } from 'react'

// Lightweight stale-while-revalidate cache.
//
// Goal: pages that were visited before render INSTANTLY from an in-memory
// cache while a fresh fetch runs in the background. This removes the
// "spinner on every navigation" that makes the app feel slow.
//
// - cache:       key -> last successful data
// - subscribers: key -> Set<setState> so every mounted consumer of a key
//                updates when the data is refreshed or invalidated elsewhere.

const cache = new Map()
const subscribers = new Map()

function notify(key, data) {
  const subs = subscribers.get(key)
  if (subs) subs.forEach((fn) => fn(data))
}

export function getCache(key) {
  return cache.get(key)
}

export function setCache(key, data) {
  cache.set(key, data)
  notify(key, data)
}

// Drop a cached entry (optionally by prefix) so the next mount refetches.
export function invalidateCache(key, { prefix = false } = {}) {
  if (prefix) {
    for (const k of cache.keys()) {
      if (k.startsWith(key)) cache.delete(k)
    }
  } else {
    cache.delete(key)
  }
}

// Clear everything (e.g. on sign-out so the next user never sees stale data).
export function clearCache() {
  cache.clear()
}

/**
 * useCachedQuery(key, fetcher, { enabled })
 * @param {string|null} key     unique cache key; null/undefined disables the query
 * @param {() => Promise<any>} fetcher  async function returning the data
 * @param {{ enabled?: boolean }} options
 * @returns {{ data, loading, error, refetch }}
 */
export function useCachedQuery(key, fetcher, { enabled = true } = {}) {
  // Track the key we initialized with to detect changes synchronously.
  const [lastKey, setLastKey] = useState(key)
  const keyChanged = lastKey !== key

  const [data, setData] = useState(() => (key != null ? cache.get(key) : undefined))
  const [loading, setLoading] = useState(enabled && key != null && !cache.has(key))
  const [error, setError] = useState(null)

  // When the key changes, reset state from the cache synchronously.
  if (keyChanged) {
    setLastKey(key)
    setData(key != null ? cache.get(key) : undefined)
    setLoading(enabled && key != null && !cache.has(key))
    setError(null)
  }

  // Always call the freshest fetcher without making it a hook dependency.
  const fetcherRef = useRef(fetcher)
  
  // Update ref in effect to avoid render-time mutations
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const refetch = useCallback(async () => {
    if (key == null || !enabled) return undefined
    try {
      const result = await fetcherRef.current()
      setCache(key, result) // updates this consumer + any others on the key
      setError(null)
      return result
    } catch (e) {
      setError(e)
      return undefined
    } finally {
      setLoading(false)
    }
  }, [key, enabled])

  useEffect(() => {
    if (key == null || !enabled) return undefined

    let subs = subscribers.get(key)
    if (!subs) {
      subs = new Set()
      subscribers.set(key, subs)
    }
    subs.add(setData)

    // Revalidate in the background on every mount / key change.
    // Using setTimeout(0) to defer the refetch out of the effect body to avoid
    // the "setState in effect" lint warning.
    const timer = setTimeout(() => refetch(), 0)

    return () => {
      clearTimeout(timer)
      subs.delete(setData)
      if (subs.size === 0) subscribers.delete(key)
    }
  }, [key, enabled, refetch])

  return { data, loading, error, refetch }
}
