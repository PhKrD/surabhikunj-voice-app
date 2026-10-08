// Calendar dates as 'YYYY-MM-DD' in the DEVICE'S local time zone.
//
// `new Date().toISOString().split('T')[0]` is the UTC date: in India
// (UTC+5:30) it is still "yesterday" until 05:30 every morning, so early
// Sadhana entries, tasks and screen-time figures landed on the wrong day.
// Everything that means "today" must use these helpers instead.
//
// Dependency-free so node --test can import it.

const pad = (n) => String(n).padStart(2, '0')

/** Local calendar date of `date` (default now) as 'YYYY-MM-DD'. */
export function localDateISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Adds whole days to a 'YYYY-MM-DD' string, independent of time zone and DST. */
export function shiftDateISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
