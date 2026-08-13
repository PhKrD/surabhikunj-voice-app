// VOICE — lightweight service worker (no build dependency)
// Strategy:
//   - Navigations: network-first, always revalidate. The cached shell is only
//     used when offline, and is replaced immediately on a successful fetch.
//     This prevents blank screens on iOS PWAs after Vercel redeploys because
//     the cached index.html is updated to point at the new hashed JS bundles.
//   - Same-origin GET assets: stale-while-revalidate for hashed filenames.
//   - Cross-origin requests (Supabase API/auth): never intercepted.

const CACHE_VERSION = 'skv-cache-v3'
const APP_SHELL = ['/', '/index.html', '/icon.svg', '/favicon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ---- Web Push: show a system notification (with sound) when one arrives ----
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'VOICE', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'VOICE'
  const options = {
    body: payload.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [120, 60, 120],
    tag: payload.type || 'general',
    renotify: true,
    data: { type: payload.type, reference_id: payload.reference_id, url: '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    })
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only handle same-origin requests; let Supabase & other APIs hit the network.
  if (url.origin !== self.location.origin) return

  // App navigations: always hit the network first and refresh the cache.
  // This is the key to avoiding blank screens after redeployment.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {})
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Static assets: serve from cache, refresh in the background.
  // Hashed Vite filenames are immutable; this is safe.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
