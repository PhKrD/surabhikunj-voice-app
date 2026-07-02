import { cn } from '@/lib/utils'

const gradientMap = {
  saffron: 'grad-saffron glow-saffron',
  tulasi: 'grad-tulasi glow-tulasi',
  lotus: 'grad-lotus glow-lotus',
  blue: 'grad-blue glow-blue',
  indigo: 'grad-indigo glow-indigo',
  slate: 'bg-gradient-to-br from-slate-600 to-slate-800',
}

export default function StatCard({ label, value, icon: Icon, color = 'saffron', trend, className }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl p-5 text-white hover-lift',
        gradientMap[color] ?? gradientMap.saffron,
        className
      )}
    >
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/15 blur-xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-6 w-24 h-24 rounded-full bg-black/10 blur-xl" />

      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{label}</p>
          <p className="text-3xl font-extrabold mt-1 drop-shadow-sm">{value}</p>
          {trend != null && trend !== 0 && (
            <p className="text-xs mt-1.5 font-medium text-white/90">
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last week
            </p>
          )}
        </div>
        {Icon && (
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/20 backdrop-blur-sm ring-1 ring-white/30 flex-shrink-0">
            <Icon className="w-6 h-6" />
          </div>
        )}
      </div>
    </div>
  )
}
