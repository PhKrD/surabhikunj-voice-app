import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const variants = {
  primary:   'grad-saffron text-white glow-saffron sheen hover:brightness-[1.07]',
  tulasi:    'grad-tulasi text-white glow-tulasi sheen hover:brightness-[1.07]',
  danger:    'grad-rose text-white shadow-[0_10px_26px_-8px_rgba(244,63,94,0.55)] sheen hover:brightness-[1.07]',
  blue:      'grad-blue text-white glow-blue sheen hover:brightness-[1.07]',
  secondary: 'bg-white text-slate-700 border border-slate-200 elev-1 hover:border-slate-300 hover:bg-slate-50 hover:elev-2',
  ghost:     'text-slate-600 hover:bg-slate-100/80 hover:text-slate-800',
  soft:      'bg-saffron-50 text-saffron-700 border border-saffron-100 hover:bg-saffron-100',
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
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-saffron-400/35',
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
