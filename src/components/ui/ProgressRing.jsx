import { cn } from '@/lib/utils'

/**
 * Compact circular progress indicator used on stat cards / summaries.
 * `value` is a 0-100 percentage. `color` accepts a CSS color value
 * (defaults to the current VOICE primary color).
 */
export default function ProgressRing({
  value = 0,
  size = 56,
  strokeWidth = 5,
  color = 'var(--color-primary)',
  trackColor = 'var(--border-color)',
  label,
  className,
}) {
  const pct = Math.max(0, Math.min(100, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className={cn('relative inline-flex items-center justify-center flex-shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-primary-token">{label ?? `${Math.round(pct)}%`}</span>
      </div>
    </div>
  )
}
