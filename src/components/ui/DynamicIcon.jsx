import { createElement } from 'react'
import { getIcon } from '@/lib/icons'

/**
 * Renders an icon chosen by name at runtime (navigation, categories,
 * branding). Unknown names render `fallback`.
 */
export default function DynamicIcon({ name, fallback, ...props }) {
  return createElement(getIcon(name, fallback ?? undefined), props)
}
