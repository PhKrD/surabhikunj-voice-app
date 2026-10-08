import { cn } from '@/lib/utils'

/**
 * Card surface.
 *
 * variant  'solid' (default) | 'glass' (alias of solid) | 'outline' | 'muted'
 * hover    pressable affordance (use for clickable cards)
 * accent   optional colour class painted as a thin top edge
 * padded   apply the standard inner padding directly
 */
export default function Card({
  children,
  className,
  variant = 'solid',
  hover = false,
  accent,
  padded = false,
  as: Tag = 'div',
  ...props
}) {
  const variants = {
    solid:   'bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-1)]',
    glass:   'bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-1)]',
    outline: 'bg-transparent border border-[var(--border-color)]',
    muted:   'bg-[var(--surface-muted)] border border-transparent',
  }

  return (
    <Tag
      className={cn(
        'relative rounded-[var(--radius-lg)] overflow-hidden',
        variants[variant] ?? variants.solid,
        hover && 'cursor-pointer press transition-shadow duration-200 hover:shadow-[var(--shadow-2)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
      {...props}
    >
      {accent && <span className={cn('absolute inset-x-0 top-0 h-1', accent)} aria-hidden />}
      {children}
    </Tag>
  )
}

export { Card as AppCard }

export function CardHeader({ children, className, border = false }) {
  return (
    <div className={cn('px-4 sm:px-5 pt-4 sm:pt-5 pb-3', border && 'border-b border-[var(--border-color)]', className)}>
      {children}
    </div>
  )
}

export function CardBody({ children, className }) {
  return <div className={cn('px-4 sm:px-5 pb-4 sm:pb-5', className)}>{children}</div>
}

export function CardFooter({ children, className }) {
  return (
    <div className={cn('px-4 sm:px-5 py-3.5 bg-[var(--surface-muted)] border-t border-[var(--border-color)]', className)}>
      {children}
    </div>
  )
}

/** Section title inside CardHeader: icon chip + text + optional action. */
export function CardTitle({ icon: Icon, children, action, subtitle, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-primary-soft)] flex items-center justify-center flex-shrink-0">
            <Icon className="w-[18px] h-[18px] text-[var(--color-primary)]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-heading text-primary-token truncate">{children}</h3>
          {subtitle && <p className="text-caption truncate">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
