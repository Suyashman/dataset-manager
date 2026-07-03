interface MetricsChartProps {
  metrics: Record<string, number>[];
  metricKey: string;
  label: string;
  color: string;
}

export function MetricsChart({ metrics, metricKey, label, color }: MetricsChartProps) {
  const points = metrics.filter((m) => metricKey in m).map((m) => ({ x: m.epoch, y: m[metricKey] }));
  if (points.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground border border-border rounded-md">
        Waiting for data...
      </div>
    );
  }

  const width = 400;
  const height = 128;
  const padding = 8;
  const leftGutter = 44;
  const bottomGutter = 14;
  const plotW = width - leftGutter - padding;
  const plotH = height - padding - bottomGutter;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys) || 1;

  const scaleX = (x: number) => leftGutter + ((x - minX) / (maxX - minX || 1)) * plotW;
  const scaleY = (y: number) => padding + plotH - ((y - minY) / (maxY - minY || 1)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x)} ${scaleY(p.y)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <div className="border border-border rounded-md p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-mono">{last.y.toFixed(4)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32">
        <line x1={leftGutter} y1={padding} x2={leftGutter} y2={padding + plotH} stroke="currentColor" strokeOpacity={0.2} />
        <line x1={leftGutter} y1={padding + plotH} x2={leftGutter + plotW} y2={padding + plotH} stroke="currentColor" strokeOpacity={0.2} />

        <text x={leftGutter - 4} y={padding + 4} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>
          {maxY.toFixed(2)}
        </text>
        <text x={leftGutter - 4} y={padding + plotH} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>
          {minY.toFixed(2)}
        </text>

        <text x={leftGutter} y={height - 2} textAnchor="start" fontSize={9} fill="currentColor" opacity={0.6}>
          {minX}
        </text>
        <text x={leftGutter + plotW} y={height - 2} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>
          {maxX}
        </text>

        <path d={path} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </div>
  );
}
