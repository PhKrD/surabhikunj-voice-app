import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import Toaster from '@/components/ui/Toaster'

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </>
  )
}
