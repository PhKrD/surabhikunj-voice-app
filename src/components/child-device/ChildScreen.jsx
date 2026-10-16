// Shared layout for the child's own screens (home, ask for time, requests,
// pairing, setup). One header style, one card style, design tokens only —
// so every child screen looks like the same app and follows dark mode.
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function ChildPage({ children, className }) {
  return (
    <div className={cn('min-h-svh app-bg flex flex-col', className)} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {children}
    </div>
  )
}

/** Brand hero. `back` = path or true for history back. */
export function ChildHeader({ title, subtitle, back, children, className }) {
  const navigate = useNavigate()
  return (
    <header
      className={cn('grad-brand text-white px-6 pb-8 rounded-b-[2rem] shadow-[var(--shadow-2)]', className)}
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}
    >
      {back && (
        <button
          type="button"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
          className="-ml-2 mb-3 inline-flex items-center gap-1.5 h-10 px-2 rounded-full text-sm font-medium text-white/80 active:bg-white/10"
        >
          <ArrowLeft className="w-[18px] h-[18px]" /> Back
        </button>
      )}
      {title && <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight">{title}</h1>}
      {subtitle && <p className="text-sm text-white/75 mt-1">{subtitle}</p>}
      {children}
    </header>
  )
}

export function ChildCard({ children, className, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={cn('bg-[var(--surface)] border border-[var(--border-color)] rounded-[var(--radius-lg)] shadow-[var(--shadow-1)]', className)}
      {...props}
    >
      {children}
    </Tag>
  )
}

const NOTE_TONES = {
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
}

export function ChildNote({ tone = 'info', icon: Icon, children, className }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium', NOTE_TONES[tone], className)}>
      {Icon && <Icon className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden="true" />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Full-width primary action pinned at the bottom of a child screen. */
export function ChildPrimaryButton({ children, className, ...props }) {
  return (
    <button
      className={cn(
        'press w-full h-14 rounded-[var(--radius-lg)] font-bold text-base flex items-center justify-center gap-2',
        'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[var(--shadow-2)]',
        'disabled:opacity-50 disabled:shadow-none',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
