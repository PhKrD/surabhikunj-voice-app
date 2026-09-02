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
    solid:   'surface border elev-1',
    glass:   'glass elev-2 dark:bg-[var(--surface-elevated)]/80',
    outline: 'surface-muted border',
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
        border && 'border-b',
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
    <div className={cn('px-5 py-4 surface-muted border-t', className)}>
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
          <span className="w-8 h-8 rounded-xl bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-900)] flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-[var(--color-primary-600)] dark:text-[var(--color-primary-300)]" />
          </span>
        )}
        <h3 className="font-bold text-primary-token truncate">{children}</h3>
      </div>
      {action}
    </div>
  )
}
