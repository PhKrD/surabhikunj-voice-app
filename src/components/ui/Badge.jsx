import { cn } from '@/lib/utils'

const variants = {
  default: 'surface-muted text-secondary-token',
  primary: 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)]',
  saffron: 'bg-saffron-100 text-saffron-700 dark:bg-saffron-900/40 dark:text-saffron-300',
  tulasi: 'bg-tulasi-100 text-tulasi-700 dark:bg-tulasi-900/40 dark:text-tulasi-300',
  lotus: 'bg-lotus-100 text-lotus-700 dark:bg-lotus-900/40 dark:text-lotus-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
}

const dotColors = {
  default: 'bg-slate-400',
  primary: 'bg-[var(--color-primary)]',
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
