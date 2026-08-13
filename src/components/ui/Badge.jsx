import { cn } from '@/lib/utils'

const variants = {
  default: 'bg-slate-100 text-slate-700',
  saffron: 'bg-saffron-100 text-saffron-700',
  tulasi: 'bg-tulasi-100 text-tulasi-700',
  lotus: 'bg-lotus-100 text-lotus-700',
  blue: 'bg-blue-100 text-blue-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  cyan: 'bg-cyan-100 text-cyan-700',
}

const dotColors = {
  default: 'bg-slate-400',
  saffron: 'bg-saffron-500',
  tulasi: 'bg-tulasi-500',
  lotus: 'bg-lotus-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  cyan: 'bg-cyan-500',
}

export default function Badge({ children, variant = 'default', dot = false, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-tight',
        variants[variant],
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant])} />
      )}
      {children}
    </span>
  )
}
