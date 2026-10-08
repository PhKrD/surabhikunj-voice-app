import { cn } from '@/lib/utils'

// Semantic tones first; legacy colour names map onto them so existing
// screens pick up the design system.
const variants = {
  default: 'bg-[var(--surface-muted)] text-secondary-token',
  primary: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)]',
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  accent: 'bg-[var(--color-accent-soft)] text-[var(--color-warning)]',
  // Legacy aliases
  saffron: 'bg-[var(--color-accent-soft)] text-[var(--color-warning)]',
  tulasi: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  lotus: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-strong)]',
  blue: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  red: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  yellow: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  cyan: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
}

const dotColors = {
  default: 'bg-[var(--text-muted)]',
  primary: 'bg-[var(--color-primary)]',
  success: 'bg-[var(--color-success)]', tulasi: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]', yellow: 'bg-[var(--color-warning)]', saffron: 'bg-[var(--color-accent)]', accent: 'bg-[var(--color-accent)]',
  danger: 'bg-[var(--color-danger)]', red: 'bg-[var(--color-danger)]',
  info: 'bg-[var(--color-info)]', blue: 'bg-[var(--color-info)]', cyan: 'bg-[var(--color-info)]',
  lotus: 'bg-[var(--color-primary)]',
}

export default function Badge({ children, variant = 'default', dot = false, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap',
        variants[variant] ?? variants.default,
        className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant] ?? dotColors.default)} aria-hidden="true" />}
      {children}
    </span>
  )
}

// Workflow states used across services, tasks, cleanliness, requests and
// broadcasts → one consistent colour and label each.
const STATUS = {
  pending: ['warning', 'Pending'],
  assigned: ['info', 'Assigned'],
  in_progress: ['info', 'In progress'],
  submitted: ['info', 'Submitted'],
  done: ['success', 'Done'],
  completed: ['success', 'Completed'],
  approved: ['success', 'Approved'],
  verified: ['success', 'Verified'],
  active: ['success', 'Active'],
  sent: ['success', 'Sent'],
  delivered: ['success', 'Delivered'],
  scheduled: ['primary', 'Scheduled'],
  draft: ['default', 'Draft'],
  rejected: ['danger', 'Rejected'],
  failed: ['danger', 'Failed'],
  missed: ['danger', 'Missed'],
  overdue: ['danger', 'Overdue'],
  cancelled: ['default', 'Cancelled'],
  archived: ['default', 'Archived'],
  inactive: ['default', 'Inactive'],
}

/** <StatusBadge status="in_progress" /> → consistent colour + readable label. */
export function StatusBadge({ status, label, className }) {
  const key = String(status ?? '').toLowerCase()
  const [variant, text] = STATUS[key] ?? ['default', key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())]
  return (
    <Badge variant={variant} dot className={className}>
      {label ?? text}
    </Badge>
  )
}
