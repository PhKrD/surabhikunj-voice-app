// Pure geo helpers for the parent's Location tab. Dependency-free → node --test.

/**
 * Accepts what a parent can actually copy: "18.5204, 73.8567", a Google
 * Maps link (…/@18.52,73.85,15z or ?q=18.52,73.85) or an OSM link
 * (#map=15/18.52/73.85). Returns null when no coordinates are found.
 */
export function parseCoordinates(text) {
  const t = String(text ?? '').trim()
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /map=\d+\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/,
    /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (!m) continue
    const lat = Number(m[1]); const lng = Number(m[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  return null
}
