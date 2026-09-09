/**
 * webCategories.js
 *
 * Website filtering categories shown in Parental Control -> Website
 * filtering -> Categories. Mirrors android/.../dpc/WebCategories.kt
 * EXACTLY (same keys, same seed domain lists) — keep both in sync.
 *
 * HONEST LIMITATION: unlike a cloud content-classification service, this
 * is a curated SEED LIST of well-known domains per category, not a
 * real-time ML classifier that recognizes every site on the internet.
 * A blocked category catches every domain in its seed list (and any
 * custom domain a parent adds under "Websites"); it will not catch an
 * unlisted site that happens to host the same kind of content. Turning
 * on "Block unknown websites" (see Settings) closes most of that gap by
 * default-denying anything not explicitly categorized or allowed, at
 * the cost of also blocking harmless uncategorized sites.
 */

export const WEB_CATEGORIES = [
  { key: 'educational', label: 'Educational', icon: 'BookOpen', defaultAction: 'allow' },
  { key: 'government', label: 'Government', icon: 'Landmark', defaultAction: 'allow' },
  { key: 'entertainment', label: 'Entertainment', icon: 'Clapperboard', defaultAction: 'allow' },
  { key: 'search_engines', label: 'Search engines', icon: 'Search', defaultAction: 'allow' },
  { key: 'news', label: 'News', icon: 'Newspaper', defaultAction: 'allow' },
  { key: 'sports', label: 'Sports', icon: 'Trophy', defaultAction: 'allow' },
  { key: 'business', label: 'Business', icon: 'Briefcase', defaultAction: 'allow' },
  { key: 'social_media', label: 'Social media', icon: 'Users', defaultAction: 'allow' },
  { key: 'gambling', label: 'Gambling', icon: 'Dices', defaultAction: 'block' },
  { key: 'proxies_loopholes', label: 'Proxies/Loopholes', icon: 'Server', defaultAction: 'block' },
  { key: 'violence', label: 'Violence', icon: 'Swords', defaultAction: 'block' },
  { key: 'weapons', label: 'Weapons', icon: 'Crosshair', defaultAction: 'block' },
  { key: 'profanity', label: 'Profanity', icon: 'MessageSquareWarning', defaultAction: 'block' },
  { key: 'mature_content', label: 'Mature content', icon: 'CircleOff', defaultAction: 'block' },
  { key: 'pornography', label: 'Pornography', icon: 'EyeOff', defaultAction: 'block' },
  { key: 'alcohol', label: 'Alcohol', icon: 'Wine', defaultAction: 'block' },
  { key: 'drugs', label: 'Drugs', icon: 'Pill', defaultAction: 'block' },
  { key: 'tobacco', label: 'Tobacco', icon: 'Cigarette', defaultAction: 'block' },
]

export const WEB_CATEGORY_KEYS = WEB_CATEGORIES.map((c) => c.key)

export function categoryLabel(key) {
  return WEB_CATEGORIES.find((c) => c.key === key)?.label ?? key
}
