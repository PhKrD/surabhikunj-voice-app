import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

// ─── Scroll restoration ──────────────────────────────────────────────────────
// Problem: React Router unmounts/remounts pages on navigation. Pages re-fetch
// data async, so the scroll container is initially SHORT (no content yet).
// A single scrollTop = saved call gets clamped to 0. We must retry until
// the content has loaded and the container is tall enough.
//
// sessionStorage key → survives iOS PWA background-eviction restarts.
// location.key       → unique per history entry (back/forward aware).

const SS = (k) => `_sv_scroll_${k}`

function restoreWithRetry(el, target, signal) {
  if (!el) return
  if (target <= 0) {
    el.scrollTop = 0
    return
  }

  let alive = true
  if (signal) signal.addEventListener('abort', () => { alive = false })

  let attempts = 0
  function tick() {
    if (!alive) return
    el.scrollTop = target
    attempts++
    // Done when we land within 5 px, or after 2 s (40 × 50 ms)
    if (Math.abs(el.scrollTop - target) <= 5 || attempts >= 40) {
      alive = false
      return
    }
    setTimeout(tick, 50)
  }

  // Two rAFs let the browser finish its first paint before we start
  requestAnimationFrame(() => requestAnimationFrame(tick))
}

// ─── Layout ──────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const mainRef   = useRef(null)
  const location  = useLocation()
  const abortRef  = useRef(null)  // AbortController for the in-flight restoration

  // 1. SAVE — write scrollTop to sessionStorage on every scroll tick
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const save = () => {
      try {
        sessionStorage.setItem(SS(location.key), String(Math.round(el.scrollTop)))
      } catch { /* quota */ }
    }
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [location.key])

  // 2. RESTORE — retry-until-tall when the route changes
  useEffect(() => {
    const el = mainRef.current
    if (!el) return

    // Cancel any restoration that's still looping from the previous navigation
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    let target = 0
    try {
      const raw = sessionStorage.getItem(SS(location.key))
      if (raw != null) target = parseInt(raw, 10) || 0
    } catch { /* private browsing */ }

    restoreWithRetry(el, target, ac.signal)

    return () => ac.abort()
  }, [location.key])

  return (
    <div className="flex h-screen app-bg overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main ref={mainRef} className="flex-1 scroll-container p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
