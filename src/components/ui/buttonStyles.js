import { cn } from '@/lib/utils'

// Single-tone buttons with a soft neutral shadow. Variant names are kept from
// the previous design so every existing screen picks up the new look.
export const variants = {
  primary:   'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[var(--shadow-1)] hover:bg-[var(--color-primary-strong)] active:bg-[var(--color-primary-strong)]',
  secondary: 'bg-[var(--surface)] text-primary-token border border-[var(--border-strong)] hover:bg-[var(--surface-muted)]',
  soft:      'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)] hover:brightness-95',
  ghost:     'text-secondary-token hover:bg-[var(--surface-muted)] hover:text-primary-token',
  danger:    'bg-[var(--color-danger)] text-white shadow-[var(--shadow-1)] hover:brightness-110',
  'danger-soft': 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:brightness-95',
  // Legacy colour variants, kept for existing screens.
  tulasi:    'bg-tulasi-600 text-white shadow-[var(--shadow-1)] hover:bg-tulasi-700',
  blue:      'bg-blue-600 text-white shadow-[var(--shadow-1)] hover:bg-blue-700',
}

// Heights meet the 44px minimum touch target from md upward.
export const sizes = {
  xs: 'h-8 px-3 text-xs rounded-[var(--radius-sm)] gap-1.5',
  sm: 'h-9 px-3.5 text-sm rounded-[var(--radius-sm)] gap-1.5',
  md: 'h-11 px-5 text-sm rounded-[var(--radius-md)] gap-2',
  lg: 'h-12 px-6 text-[0.9375rem] rounded-[var(--radius-md)] gap-2.5',
  icon: 'h-11 w-11 rounded-[var(--radius-md)]',
}

export const iconSizes = { xs: 'w-3.5 h-3.5', sm: 'w-4 h-4', md: 'w-[18px] h-[18px]', lg: 'w-5 h-5', icon: 'w-5 h-5' }

export const BASE = cn(
  'relative inline-flex items-center justify-center font-semibold whitespace-nowrap select-none',
  'transition-[background-color,filter,transform,box-shadow] duration-150 press',
  'focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--color-primary)_30%,transparent)]',
)

/** Button styling for non-button elements, e.g. a router <Link>. */
export function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return cn(BASE, variants[variant] ?? variants.primary, sizes[size] ?? sizes.md, className)
}
