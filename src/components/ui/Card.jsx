import { cn } from '@/lib/utils'

/**
 * Card surface.
 *
 * variant  'solid' (default) | 'glass' | 'outline'
 * hover    adds lift + deeper shadow on hover (use for clickable cards)
 * accent   optional gradient class (e.g. 'grad-saffron') painted as a top edge
 */
export default function Card({
  children,
  className,
  variant = 'solid',
  hover = false,
  accent,
  ...props
}) {
  const variants = {
    solid:   'bg-white border border-slate-100/90 elev-2',
    glass:   'glass elev-3',
    outline: 'bg-white/60 border border-slate-200',
  }

  return (
    <div
      className={cn(
        'relative rounded-3xl overflow-hidden',
        variants[variant],
        hover && 'hover-lift cursor-pointer hover:elev-4',
        'transition-shadow duration-300',
        className
      )}
      {...props}
    >
      {accent && (
        <span className={cn('absolute inset-x-0 top-0 h-1', accent)} aria-hidden />
      )}
      {children}
    </div>
  )
}

export function CardHeader({ children, className, border = false }) {
  return (
    <div
      className={cn(
        'px-5 pt-5 pb-3',
        border && 'border-b border-slate-100',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardBody({ children, className }) {
  return <div className={cn('px-5 pb-5', className)}>{children}</div>
}

export function CardFooter({ children, className }) {
  return (
    <div className={cn('px-5 py-4 bg-slate-50/70 border-t border-slate-100', className)}>
      {children}
    </div>
  )
}

/** Section title used inside CardHeader — icon + text, consistent everywhere. */
export function CardTitle({ icon: Icon, children, action, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <span className="w-8 h-8 rounded-xl bg-saffron-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-saffron-500" />
          </span>
        )}
        <h3 className="font-bold text-slate-800 truncate">{children}</h3>
      </div>
      {action}
    </div>
  )
}
