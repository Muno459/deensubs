import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const tooltipStyle = {
  background: '#0b0b10',
  border: '1px solid rgba(196,164,76,0.25)',
  borderRadius: 10,
  fontSize: 12,
  color: '#eae6da',
  boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
};

export function GoldArea({
  data,
  x,
  y,
  height = 220,
}: {
  data: any[];
  x: string;
  y: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#45b3a2" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#45b3a2" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey={x}
          tick={{ fill: '#8f8a7c', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: string) => (typeof v === 'string' ? v.slice(5) : v)}
        />
        <YAxis tick={{ fill: '#8f8a7c', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'rgba(196,164,76,0.3)' }} />
        <Area
          type="monotone"
          dataKey={y}
          stroke="#6ecfbf"
          strokeWidth={2}
          fill="url(#goldFill)"
          animationDuration={900}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function GoldBars({
  data,
  x,
  y,
  height = 200,
}: {
  data: any[];
  x: string;
  y: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey={x} tick={{ fill: '#8f8a7c', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8f8a7c', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(196,164,76,0.06)' }} />
        <Bar dataKey={y} fill="#45b3a2" radius={[4, 4, 0, 0]} animationDuration={900} />
      </BarChart>
    </ResponsiveContainer>
  );
}
