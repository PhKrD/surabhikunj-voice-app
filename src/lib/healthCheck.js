/**
 * Database health monitoring with automatic failover
 */

import { supabase } from './supabase'

class HealthMonitor {
  constructor() {
    this.status = {
      supabase: 'unknown',
      redis: 'unknown',
      lastCheck: null,
      errors: []
    }
    
    // Start monitoring
    this.checkHealth()
    setInterval(() => this.checkHealth(), 30000) // Check every 30s
  }

  async checkHealth() {
    const results = await Promise.allSettled([
      this.checkSupabase(),
      this.checkRedis()
    ])
    
    this.status.lastCheck = new Date().toISOString()
    
    // Notify if status changed
    if (this.status.supabase === 'down') {
      console.warn('[health] Supabase is down, using offline mode')
      this.notifyUser('Database temporarily unavailable. Working offline.')
    }
  }

  async checkSupabase() {
    try {
      const start = Date.now()
      const { error } = await Promise.race([
        supabase.from('voices').select('id').limit(1),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 3000)
        )
      ])
      
      const latency = Date.now() - start
      
      if (error) throw error
      
      this.status.supabase = latency > 2000 ? 'degraded' : 'healthy'
      this.status.supabaseLatency = latency
      
      return true
    } catch (error) {
      this.status.supabase = 'down'
      this.status.errors.push({
        service: 'supabase',
        error: error.message,
        time: new Date().toISOString()
      })
      return false
    }
  }

  async checkRedis() {
    // Check Redis if configured
    const { redisCache } = await import('./redisCache')
    if (!redisCache.enabled) {
      this.status.redis = 'disabled'
      return true
    }
    
    try {
      const testKey = `health:${Date.now()}`
      await redisCache.set(testKey, 'ok', 10)
      const result = await redisCache.get(testKey)
      
      this.status.redis = result === 'ok' ? 'healthy' : 'degraded'
      return true
    } catch (error) {
      this.status.redis = 'down'
      return false
    }
  }

  notifyUser(message) {
    // Show toast notification if available
    if (window.showToast) {
      window.showToast(message, 'warning')
    }
  }

  isHealthy() {
    return this.status.supabase === 'healthy' || this.status.supabase === 'degraded'
  }

  shouldUseOffline() {
    return this.status.supabase === 'down' || !navigator.onLine
  }
}

export const healthMonitor = new HealthMonitor()

// Expose status for debugging
if (typeof window !== 'undefined') {
  window.healthStatus = () => healthMonitor.status
}
