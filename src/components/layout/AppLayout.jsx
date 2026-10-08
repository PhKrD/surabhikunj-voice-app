import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import { MaintenanceAdminBanner, NoticeBanner, OfflineBanner, UpdateBanner } from '@/components/system/Banners'

// ─── Scroll restoration ──────────────────────────────────────────────────────
// Pages re-fetch data async, so the scroll container is initially SHORT. A
// single scrollTop = saved call gets clamped to 0; retry until the content
// has loaded and the container is tall enough.
//
// sessionStorage key → survives Android/iOS background-eviction restarts.
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
  requestAnimationFrame(() => requestAnimationFrame(tick))
}

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mainRef = useRef(null)
  const location = useLocation()
  const abortRef = useRef(null)

  // Navigating anywhere closes the drawer.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 1. SAVE — write scrollTop to sessionStorage on every scroll tick
  useEffect(() => {
    const el = mainRef.current
    if (!el) return undefined
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
    if (!el) return undefined
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
    <div className="flex h-svh app-bg overflow-hidden">
      <Sidebar mobileOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <MaintenanceAdminBanner />
        <OfflineBanner />
        <UpdateBanner />
        <NoticeBanner />
        <main ref={mainRef} className="flex-1 scroll-container">
          {/*
            Page transition: opacity-only and enter-only, because the scroll
            restoration above sets scrollTop while the new page loads and an
            exit animation or a translate would fight it.
          */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="w-full max-w-6xl mx-auto px-4 pt-4 pb-safe-nav lg:px-8 lg:pt-6 lg:pb-10"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
      <BottomNav onMore={() => setDrawerOpen((v) => !v)} moreOpen={drawerOpen} />
    </div>
  )
}
