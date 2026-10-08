import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { installGlobalErrorHandlers, reportError } from '@/lib/errorReporter'
import BootFailure from '@/components/BootFailure'

// Unexpected errors are reported (see errorReporter.js), never painted over
// the app: a stray rejected promise must not replace a working screen with a
// stack trace.
installGlobalErrorHandlers()

const isNative = Boolean(window.Capacitor?.isNativePlatform?.())

const root = createRoot(document.getElementById('root'))

import('./App.jsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((error) => {
    reportError(error, { kind: 'boot' })
    root.render(<BootFailure />)
  })

// Native OTA, loaded lazily so the updater plugin is not in the boot bundle.
import('./lib/liveUpdate.js')
  .then((m) => m.initLiveUpdates())
  .catch((error) => reportError(error, { kind: 'live-update' }))

// The service worker is for the web/PWA build only. Inside the native app the
// OTA updater owns which bundle is served; a SW cache would fight it.
if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
