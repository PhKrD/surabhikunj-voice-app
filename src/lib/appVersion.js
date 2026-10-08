// The web bundle's version, injected at build time from package.json (see
// vite.config.js `define`). Each OTA bundle carries its own number, so this
// identifies exactly which JS a user is running — independent of the APK.
// eslint-disable-next-line no-undef
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'

/**
 * Compares dotted version strings numerically: "1.10.0" > "1.9.3".
 * Returns -1, 0 or 1. Missing parts count as 0.
 */
export function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b ?? '0').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}
