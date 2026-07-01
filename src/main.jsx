import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Native OTA, loaded lazily so the capacitor-updater plugin is NOT in the boot
// bundle: mark the current bundle good + fetch any newer bundle for next launch.
import('./lib/liveUpdate.js').then((m) => m.initLiveUpdates())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
