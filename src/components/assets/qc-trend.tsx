/** Trend of one measured QC item (wave 40): points over time with the limits as dashed lines. Server SVG, tokens only. */
type Point = { on: string; value: number; ok: boolean };

export function QcTrend({ points, min, max, unit, label, width = 640, height = 180, names = ["min", "max"] }: { points: Point[]; min: number | null; max: number | null; unit: string | null; label: string; width?: number; height?: number; names?: [string, string] }) {
  if (points.length < 2) return <p className="text-sm text-muted">At least two readings are needed for a trend.</p>;
  const vals = [...points.map((p) => p.value), ...(min != null ? [min] : []), ...(max != null ? [max] : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, pad = 28;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - 20 - ((v - lo) / span) * (height - 40);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const limit = (v: number, name: string) => (
    <g><line x1={pad} x2={width - pad} y1={y(v)} y2={y(v)} stroke="var(--color-danger)" strokeDasharray="4 4" strokeWidth="1" /><text x={width - pad} y={y(v) - 3} fontSize="10" textAnchor="end" fill="var(--color-danger)">{name} {v}</text></g>
  );
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-3xl" role="img" aria-label={`${label}${unit ? ` (${unit})` : ""}: ${points.length} readings from ${points[0].on} to ${points.at(-1)!.on}`}>
        {min != null && limit(min, names[0])}
        {max != null && limit(max, names[1])}
        <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth="1.75" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill={p.ok ? "var(--color-primary)" : "var(--color-danger)"}><title>{`${p.on}: ${p.value}${unit ? ` ${unit}` : ""}`}</title></circle>)}
        <text x={pad} y={height - 4} fontSize="10" fill="var(--color-faint)">{points[0].on}</text>
        <text x={width - pad} y={height - 4} fontSize="10" textAnchor="end" fill="var(--color-faint)">{points.at(-1)!.on}</text>
      </svg>
      <figcaption className="text-xs text-muted">{label}{unit ? `, ${unit}` : ""}. Red points are outside the limits.</figcaption>
    </figure>
  );
}
