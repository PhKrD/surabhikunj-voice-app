import { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { format, parseISO } from 'date-fns'

export default function TrackerTrendChart({ entries = [], color = '#f97316' }) {
  const data = useMemo(() => {
    return (entries ?? [])
      .filter((e) => e?.period_date && e?.score != null)
      .slice()
      .sort((a, b) => (a.period_date < b.period_date ? -1 : a.period_date > b.period_date ? 1 : 0))
      .map((e) => ({
        date: format(parseISO(e.period_date), 'dd MMM'),
        score: Number(e.score),
      }))
  }, [entries])

  if (data.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-center">
        <p className="text-sm text-muted-token">
          Not enough data yet — submit a few more entries to see your trend.
        </p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
