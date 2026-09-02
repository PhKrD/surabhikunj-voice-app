import { cn } from '@/lib/utils'
import ProgressRing from './ProgressRing'

// Accent color per stat "color" prop — a small icon chip tint rather than
// a full-bleed gradient background, so the card reads as calm/premium
// instead of a colorful tile competing for attention.
const accentMap = {
  saffron: { bg: 'bg-saffron-50 dark:bg-saffron-900/30', text: 'text-saffron-600 dark:text-saffron-300', ring: '#f97316' },
  amber:   { bg: 'bg-saffron-50 dark:bg-saffron-900/30', text: 'text-saffron-600 dark:text-saffron-300', ring: '#f97316' },
  tulasi:  { bg: 'bg-tulasi-50 dark:bg-tulasi-900/30', text: 'text-tulasi-600 dark:text-tulasi-300', ring: '#16a34a' },
  lotus:   { bg: 'bg-lotus-50 dark:bg-lotus-900/30', text: 'text-lotus-600 dark:text-lotus-300', ring: '#c026d3' },
  blue:    { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', ring: '#2563eb' },
  indigo:  { bg: 'bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-900)]', text: 'text-[var(--color-primary-600)] dark:text-[var(--color-primary-300)]', ring: '#6845e0' },
  slate:   { bg: 'surface-muted', text: 'text-secondary-token', ring: '#64748b' },
}

/**
 * value can be:
 *   - a number 0-100 → rendered as a percentage with a progress ring (pass `progress` explicitly to force this)
 *   - any other string/number → rendered as plain text, icon chip shown instead of a ring
 */
export default function StatCard({ label, value, icon: Icon, color = 'saffron', trend, progress, className }) {
  const accent = accentMap[color] ?? accentMap.saffron
  const showRing = progress != null

  return (
    <div className={cn('relative rounded-2xl p-4 surface border elev-1', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-token">{label}</p>
          <p className="text-2xl font-extrabold mt-1 text-primary-token">{value}</p>
          {trend != null && trend !== 0 && (
            <p className={cn('text-xs mt-1.5 font-medium', trend > 0 ? 'text-tulasi-600 dark:text-tulasi-400' : 'text-red-500')}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last week
            </p>
          )}
        </div>
        {showRing ? (
          <ProgressRing value={progress} size={48} strokeWidth={4} color={accent.ring} />
        ) : (
          Icon && (
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', accent.bg)}>
              <Icon className={cn('w-5 h-5', accent.text)} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
