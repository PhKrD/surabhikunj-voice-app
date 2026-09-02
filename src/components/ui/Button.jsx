import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

// Calmer, single-tone premium buttons — solid colors instead of full
// gradients, with a soft matching shadow rather than a heavy colored glow.
const variants = {
  primary:   'bg-[var(--color-primary)] text-white shadow-[0_6px_16px_-6px_var(--color-primary)] hover:brightness-110',
  tulasi:    'bg-tulasi-600 text-white shadow-[0_6px_16px_-6px_rgba(22,163,74,0.5)] hover:bg-tulasi-700',
  danger:    'bg-[var(--color-danger)] text-white shadow-[0_6px_16px_-6px_var(--color-danger)] hover:brightness-110',
  blue:      'bg-blue-600 text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.5)] hover:bg-blue-700',
  secondary: 'surface text-primary-token border hover:bg-[var(--surface-muted)]',
  ghost:     'text-secondary-token hover:bg-[var(--surface-muted)] hover:text-primary-token',
  soft:      'bg-[var(--color-primary-50)] text-[var(--color-primary-700)] border border-[var(--color-primary-100)] hover:bg-[var(--color-primary-100)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)] dark:border-transparent',
}

const sizes = {
  xs: 'px-3 py-1 text-xs rounded-lg gap-1.5',
  sm: 'px-3.5 py-1.5 text-sm rounded-xl gap-1.5',
  md: 'px-4.5 py-2.5 text-sm rounded-2xl gap-2',
  lg: 'px-6 py-3.5 text-base rounded-2xl gap-2.5',
}

const iconSizes = { xs: 'w-3.5 h-3.5', sm: 'w-4 h-4', md: 'w-4 h-4', lg: 'w-5 h-5' }

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  icon: Icon,
  iconRight: IconRight,
  ...props
}) {
  const hasLeft = loading || Boolean(Icon)
  const iconCls = iconSizes[size]

  return (
    <button
      className={cn(
        'relative inline-flex items-center justify-center font-semibold whitespace-nowrap',
        'transition-all duration-200 press',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-primary)]/30',
        'disabled:opacity-55 disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {hasLeft && (
        <span className={cn('inline-flex items-center justify-center flex-shrink-0', iconCls)}>
          {loading ? <Loader2 className={cn(iconCls, 'animate-spin')} /> : Icon ? <Icon className={iconCls} /> : null}
        </span>
      )}
      {children}
      {IconRight && !loading && (
        <span className={cn('inline-flex items-center justify-center flex-shrink-0', iconCls)}>
          <IconRight className={iconCls} />
        </span>
      )}
    </button>
  )
}
