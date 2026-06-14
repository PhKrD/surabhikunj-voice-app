import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

export default function SadhanaTrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="score" stroke="#f97316" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="japa" stroke="#d946ef" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
      </LineChart>
    </ResponsiveContainer>
  )
}
