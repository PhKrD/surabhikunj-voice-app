import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const variants = {
  primary: 'grad-saffron text-white shadow-[0_8px_20px_-6px_rgba(249,115,22,0.5)] hover:brightness-105 active:brightness-95',
  secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
  ghost: 'hover:bg-slate-100 text-slate-600',
  danger: 'grad-rose text-white shadow-[0_8px_20px_-6px_rgba(244,63,94,0.5)] hover:brightness-105 active:brightness-95',
  tulasi: 'grad-tulasi text-white shadow-[0_8px_20px_-6px_rgba(34,197,94,0.5)] hover:brightness-105 active:brightness-95',
}

const sizes = {
  sm: 'px-3.5 py-1.5 text-sm rounded-xl',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-2xl',
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
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
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
