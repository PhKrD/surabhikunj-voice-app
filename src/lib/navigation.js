// Lets non-React code (push-notification taps, deep links, the back button)
// navigate with the router instead of reloading the page. The router's
// navigate function is registered by <NavigationBridge/> in App.jsx.

let navigateFn = null
let pending = null

export function setNavigator(fn) {
  navigateFn = fn
  if (fn && pending) {
    fn(pending)
    pending = null
  }
}

/** Navigates now, or as soon as the router has mounted (cold start from a tap). */
export function navigateTo(path) {
  if (!path || typeof path !== 'string' || !path.startsWith('/')) return
  if (navigateFn) navigateFn(path)
  else pending = path
}
