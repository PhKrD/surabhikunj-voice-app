import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { BASE, iconSizes, sizes, variants } from './buttonStyles'
import { Loader2 } from 'lucide-react'
import { tap, heavy } from '@/lib/haptics'

const Button = forwardRef(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    className,
    icon: Icon,
    iconRight: IconRight,
    haptic = true,
    // No default: existing forms rely on the browser's implicit submit.
    type,
    onClick,
    ...props
  },
  ref,
) {
  const iconCls = iconSizes[size]

  // Every button taps through here, so haptics are wired once for the whole
  // app. Destructive actions get a firmer buzz.
  const handleClick = (e) => {
    if (haptic) (variant === 'danger' ? heavy : tap)()
    onClick?.(e)
  }

  return (
    <button
      ref={ref}
      type={type}
      onClick={handleClick}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none',
        variants[variant] ?? variants.primary,
        sizes[size] ?? sizes.md,
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className={cn(iconCls, 'animate-spin flex-shrink-0')} aria-hidden="true" />
      ) : (
        Icon && <Icon className={cn(iconCls, 'flex-shrink-0')} aria-hidden="true" />
      )}
      {children}
      {IconRight && !loading && <IconRight className={cn(iconCls, 'flex-shrink-0')} aria-hidden="true" />}
    </button>
  )
})

export default Button

export const PrimaryButton = forwardRef(function PrimaryButton(props, ref) {
  return <Button ref={ref} variant="primary" {...props} />
})

export const SecondaryButton = forwardRef(function SecondaryButton(props, ref) {
  return <Button ref={ref} variant="secondary" {...props} />
})

/** Square icon-only button. `label` is required: it is the accessible name. */
export function IconButton({ icon: Icon, label, className, variant = 'ghost', ...props }) {
  return (
    <Button variant={variant} size="icon" aria-label={label} title={label} className={className} {...props}>
      <Icon className="w-5 h-5" aria-hidden="true" />
    </Button>
  )
}
