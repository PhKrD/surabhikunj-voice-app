import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

function ErrorScreen({ error }) {
  return (
    <div style={{ padding: 24, fontFamily: 'monospace', background: '#fff', color: '#b91c1c', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 'bold' }}>Failed to start the app</h1>
      <p style={{ marginTop: 12 }}>{error?.message || String(error)}</p>
      <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{error?.stack}</pre>
    </div>
  )
}

function showFatal(error) {
  console.error('[fatal]', error)
  const message = error?.stack || error?.message || String(error)
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;inset:0;background:#fff;color:#b91c1c;padding:24px;font-family:monospace;white-space:pre-wrap;overflow:auto;z-index:99999'
  div.textContent = message
  document.body.appendChild(div)
}

window.onerror = (message, source, lineno, colno, error) => {
  showFatal(error || new Error(`${message} at ${source}:${lineno}:${colno}`))
}
window.addEventListener('unhandledrejection', (event) => {
  showFatal(event.reason || new Error('Unhandled promise rejection'))
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<div style="padding:24px;font-family:monospace;color:#b91c1c">#root element not found</div>'
} else {
  const root = createRoot(rootEl)

  import('./App.jsx')
    .then(({ default: App }) => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      )
    })
    .catch((error) => {
      console.error('[main] App failed to load:', error)
      root.render(<ErrorScreen error={error} />)
    })
}

// Native OTA, loaded lazily so the capacitor-updater plugin is NOT in the boot
// bundle: mark the current bundle good + fetch any newer bundle for next launch.
import('./lib/liveUpdate.js').then((m) => m.initLiveUpdates())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
