import { Loader2, AlertTriangle, RefreshCw, Inbox, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { friendlyError } from '@/lib/friendlyError'
import Button from './Button'

/** Page/section header: title, optional subtitle, actions on the right. */
export function SectionHeader({ title, subtitle, action, className, as: Tag = 'h2' }) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <Tag className="text-heading text-primary-token truncate">{title}</Tag>
        {subtitle && <p className="text-caption mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

/** Nothing to show yet — explain why, and offer the next step. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact = false }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-6 px-4' : 'py-12 px-6', className)}>
      <div className={cn('rounded-[var(--radius-lg)] bg-[var(--color-primary-soft)] flex items-center justify-center mb-4', compact ? 'w-12 h-12' : 'w-16 h-16')}>
        <Icon className={cn('text-[var(--color-primary)]', compact ? 'w-6 h-6' : 'w-7 h-7')} aria-hidden="true" />
      </div>
      <p className="text-heading text-primary-token">{title}</p>
      {description && <p className="text-caption mt-1.5 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Centred spinner for whole-page/section loads where layout is unknown. */
export function LoadingState({ label = 'Loading…', className, fullScreen = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3', fullScreen ? 'min-h-svh app-bg' : 'py-16', className)}
    >
      <Loader2 className="w-7 h-7 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
      <p className="text-caption">{label}</p>
    </div>
  )
}

/** Shimmer block. Prefer this over spinners when the layout is known. */
export function Skeleton({ className }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden="true" />
}

/** A list of card-shaped skeleton rows. */
export function SkeletonList({ rows = 4, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border-color)]">
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/3 h-3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Something failed. Shows a human-readable explanation (never the raw
 * backend message) and a retry button when the caller can retry.
 */
export function ErrorState({ error, title, onRetry, className, compact = false }) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const Icon = offline ? WifiOff : AlertTriangle
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center', compact ? 'py-6 px-4' : 'py-12 px-6', className)}>
      <div className="w-14 h-14 rounded-[var(--radius-lg)] bg-[var(--color-danger-soft)] flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-[var(--color-danger)]" aria-hidden="true" />
      </div>
      <p className="text-heading text-primary-token">{title ?? (offline ? 'You’re offline' : 'Couldn’t load this')}</p>
      <p className="text-caption mt-1.5 max-w-xs">{friendlyError(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-5">
          Try again
        </Button>
      )}
    </div>
  )
}
