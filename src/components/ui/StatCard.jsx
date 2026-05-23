import { cn } from '@/lib/utils'

export default function StatCard({ label, value, icon: Icon, color = 'saffron', trend, className }) {
  const colorMap = {
    saffron: 'bg-saffron-50 text-saffron-600 border-saffron-100',
    tulasi: 'bg-tulasi-50 text-tulasi-600 border-tulasi-100',
    lotus: 'bg-lotus-50 text-lotus-600 border-lotus-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
  }

  return (
    <div className={cn('bg-white rounded-2xl border border-slate-100 p-5 shadow-sm', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{value}</p>
          {trend && (
            <p className={cn('text-xs mt-1', trend > 0 ? 'text-tulasi-600' : 'text-red-500')}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last week
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center border', colorMap[color])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  )
}
