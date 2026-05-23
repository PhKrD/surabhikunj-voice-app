import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const variants = {
  primary: 'bg-saffron-500 hover:bg-saffron-600 text-white shadow-sm',
  secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
  ghost: 'hover:bg-slate-100 text-slate-600',
  danger: 'bg-red-500 hover:bg-red-600 text-white shadow-sm',
  tulasi: 'bg-tulasi-600 hover:bg-tulasi-700 text-white shadow-sm',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  icon: Icon,
  ...props
}) {
  const hasVisual = loading || Boolean(Icon)

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors duration-150',
        hasVisual ? 'gap-2' : 'gap-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400 focus-visible:ring-offset-1',
        'disabled:opacity-80 disabled:cursor-not-allowed disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {hasVisual ? (
        <span className="inline-flex w-4 h-4 items-center justify-center flex-shrink-0">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : Icon ? (
            <Icon className="w-4 h-4" />
          ) : null}
        </span>
      ) : null}
      {children}
    </button>
  )
}
