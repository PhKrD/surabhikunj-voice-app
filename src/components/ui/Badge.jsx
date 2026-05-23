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

export default function Badge({ children, variant = 'default', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
