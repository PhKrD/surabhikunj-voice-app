import { cn } from '@/lib/utils'
import ProgressRing from './ProgressRing'

// Icon-chip tint per `color` prop. Legacy colour names map onto the design
// system's semantic tones.
const accentMap = {
  primary: { chip: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]', ring: 'var(--color-primary)' },
  indigo:  { chip: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]', ring: 'var(--color-primary)' },
  lotus:   { chip: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]', ring: 'var(--color-primary)' },
  saffron: { chip: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]', ring: 'var(--color-accent)' },
  amber:   { chip: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]', ring: 'var(--color-accent)' },
  tulasi:  { chip: 'bg-[var(--color-success-soft)] text-[var(--color-success)]', ring: 'var(--color-success)' },
  blue:    { chip: 'bg-[var(--color-info-soft)] text-[var(--color-info)]', ring: 'var(--color-info)' },
  slate:   { chip: 'bg-[var(--surface-muted)] text-secondary-token', ring: 'var(--text-muted)' },
}

/**
 * Summary number with an icon (or a progress ring when `progress` is given).
 */
export default function StatCard({ label, value, icon: Icon, color = 'primary', trend, progress, className }) {
  const accent = accentMap[color] ?? accentMap.primary
  const showRing = progress != null

  return (
    <div className={cn('rounded-[var(--radius-lg)] p-4 bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-1)]', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-overline truncate">{label}</p>
          <p className="text-title text-primary-token mt-1 tabular">{value}</p>
          {trend != null && trend !== 0 && (
            <p className={cn('text-xs mt-1 font-semibold', trend > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last week
            </p>
          )}
        </div>
        {showRing ? (
          <ProgressRing value={progress} size={48} strokeWidth={4} color={accent.ring} />
        ) : (
          Icon && (
            <div className={cn('w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0', accent.chip)}>
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
          )
        )}
      </div>
    </div>
  )
}
