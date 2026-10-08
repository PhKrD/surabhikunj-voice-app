// Which modules earn a bottom-bar slot, by role. The server-side
// my_navigation() list already hides what a user may not open; this only
// decides what is most useful one tap away. Everything else lives in "More".
const MEMBER_PRIORITY = ['trackers', 'service', 'tasks', 'announcements', 'events', 'mentorship', 'cleanliness']
const ADMIN_PRIORITY = ['members', 'trackers', 'reports', 'service', 'announcements', 'events']
const SLOTS = 3

export function pickBottomItems(nav, isAdmin) {
  const routable = nav.filter((n) => n.key && n.route)
  const byKey = new Map(routable.map((n) => [n.key, n]))
  const order = isAdmin ? ADMIN_PRIORITY : MEMBER_PRIORITY
  const picked = order.map((k) => byKey.get(k)).filter(Boolean).slice(0, SLOTS)
  const home = byKey.get('dashboard') ?? { key: 'dashboard', route: '/', label: 'Home', icon: 'Home' }
  return [home, ...picked]
}
