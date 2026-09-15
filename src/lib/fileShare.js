// =====================================================================
// fileShare.js — deliver a generated file to the user on every platform.
//
// A plain <a download> blob link works on desktop web but silently does
// nothing inside the Capacitor Android WebView, which is where most of
// our devotees use the app. So on native we write the file to the app's
// Documents directory and hand it to Android's share sheet (WhatsApp,
// Drive, Gmail, Files…); on web we fall back to a normal download, and
// use the Web Share API when the browser supports sharing files.
//
// Capacitor plugins are imported lazily so the web bundle does not pull
// them in until an export actually happens.
// =====================================================================
import { Capacitor } from '@capacitor/core'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // result is a data URL — strip the "data:<mime>;base64," prefix.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(blob)
  })
}

function webDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Save + share a generated file.
 *
 * @returns {Promise<'shared'|'downloaded'|'saved'|'cancelled'>} how it was delivered.
 */
export async function shareFile({ blob, filename, mime, title }) {
  // Filesystem/Share are NATIVE plugins: the JS shim ships in the OTA
  // bundle but the native half only arrives with a new APK. On an older
  // install the call would fail with an opaque "not implemented", so check
  // first and say something the devotee can act on.
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) {
      throw new Error('Please update the app from the Play Store to export files.')
    }

    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])

    const data = await blobToBase64(blob)
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Documents,
      recursive: true,
    })

    try {
      await Share.share({ title: title ?? filename, files: [uri] })
      return 'shared'
    } catch (e) {
      // The user dismissing the share sheet throws; that is not an error,
      // and the file is already on disk either way.
      const msg = String(e?.message ?? '').toLowerCase()
      if (msg.includes('cancel') || msg.includes('abort') || msg.includes('dismiss')) return 'saved'
      throw e
    }
  }

  // --- Web -------------------------------------------------------------
  const file = new File([blob], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title ?? filename })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // Any other share failure — fall through to a plain download.
    }
  }

  webDownload(blob, filename)
  return 'downloaded'
}

/** Human-readable confirmation for a shareFile() result. */
export function deliveryMessage(result, filename) {
  switch (result) {
    case 'shared': return `${filename} is ready to share`
    case 'saved': return `Saved to Documents as ${filename}`
    case 'cancelled': return 'Export cancelled'
    default: return `Downloaded ${filename}`
  }
}
