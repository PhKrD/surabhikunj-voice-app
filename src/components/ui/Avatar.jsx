import { useState } from 'react'
import { cn, getInitials } from '@/lib/utils'

const sizes = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
}

// Calm tints that work in light and dark mode; chosen by name so a person
// always gets the same colour.
const tints = [
  'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)]',
  'bg-[var(--color-accent-soft)] text-[var(--color-warning)]',
  'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  'bg-[var(--color-info-soft)] text-[var(--color-info)]',
]

function tintFor(name) {
  if (!name) return tints[0]
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return tints[h % tints.length]
}

export default function Avatar({ name, url, size = 'md', className, onClick }) {
  const [broken, setBroken] = useState(false)
  const base = cn('rounded-full flex-shrink-0', sizes[size] ?? sizes.md, onClick && 'cursor-pointer', className)

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        loading="lazy"
        onError={() => setBroken(true)}
        onClick={onClick}
        className={cn(base, 'object-cover bg-[var(--surface-muted)]')}
      />
    )
  }
  return (
    <div
      onClick={onClick}
      aria-label={name ?? undefined}
      role={name ? 'img' : undefined}
      className={cn(base, 'flex items-center justify-center font-semibold select-none', tintFor(name))}
    >
      {getInitials(name)}
    </div>
  )
}

export { Avatar as UserAvatar }
