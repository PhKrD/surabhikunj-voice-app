// Android hardware/gesture back button.
//
// Overlays (dialogs, sheets, the mobile drawer) register a handler while they
// are open; the most recently opened one gets the press first, so "back"
// closes the top-most thing — exactly what Android users expect. With nothing
// open, back navigates history; on a top-level screen a second press within
// two seconds leaves the app.

const handlers = []

/**
 * @param {() => boolean} handler  return true when the press was handled
 * @returns {() => void} unregister
 */
export function registerBackHandler(handler) {
  handlers.push(handler)
  return () => {
    const i = handlers.lastIndexOf(handler)
    if (i !== -1) handlers.splice(i, 1)
  }
}

/** Runs registered overlay handlers, newest first. */
export function handleOverlayBack() {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}

// Screens where "back" means leave the app rather than go somewhere.
const ROOT_PATHS = new Set(['/', '/login', '/onboarding', '/family'])

export function isRootPath(pathname) {
  return ROOT_PATHS.has(pathname)
}
