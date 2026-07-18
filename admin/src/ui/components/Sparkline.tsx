// Tiny inline area sparkline (pure SVG, no chart lib)
export function Sparkline({
  data,
  width = 96,
  height = 28,
  className = '',
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => [i * step, height - 2 - ((v - min) / range) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = 'sp' + Math.abs(data.reduce((a, b) => a * 31 + b, 7) | 0).toString(36);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#45b3a2" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#45b3a2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="#6ecfbf" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
