import { cn, getInitials } from '@/lib/utils'

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
}

const colors = [
  'bg-saffron-100 text-saffron-700',
  'bg-tulasi-100 text-tulasi-700',
  'bg-lotus-100 text-lotus-700',
  'bg-blue-100 text-blue-700',
  'bg-cyan-100 text-cyan-700',
  'bg-indigo-100 text-indigo-700',
]

function getColor(name) {
  if (!name) return colors[0]
  const idx = name.charCodeAt(0) % colors.length
  return colors[idx]
}

export default function Avatar({ name, url, size = 'md', className }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={cn('rounded-full object-cover', sizes[size], className)}
      />
    )
  }
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold flex-shrink-0',
        sizes[size],
        getColor(name),
        className
      )}
    >
      {getInitials(name)}
    </div>
  )
}
