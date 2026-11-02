/**
 * Patient pathway diagram (wave 7, step 7b, list mode): laid out automatically from the steps and arrows, left to
 * right. Boxes show the step, its place and patients a day; arrows show their share. Server-rendered SVG, scrolls
 * sideways on a phone.
 */
import { layoutFlow, type Link, type Step } from "@/lib/flows/model";

const W = 176, H = 64, GX = 64, GY = 26, PAD = 16;

export function FlowDiagram({ steps, links, volumes, placeOf, problems }: {
  steps: Step[]; links: Link[]; volumes: Map<string, number> | null; placeOf: (s: Step) => string | null; problems: Set<string>;
}) {
  if (!steps.length) return null;
  const pos = layoutFlow(steps, links);
  const cols = Math.max(...[...pos.values()].map((p) => p.col)) + 1;
  const rows = Math.max(...[...pos.values()].map((p) => p.row)) + 1;
  const width = PAD * 2 + cols * W + (cols - 1) * GX, height = PAD * 2 + rows * H + (rows - 1) * GY + 24;
  const at = (k: string) => { const p = pos.get(k)!; return { x: PAD + p.col * (W + GX), y: PAD + p.row * (H + GY) }; };
  const fill = (s: Step) => (s.kind === "START" ? "var(--color-ok-soft)" : s.kind === "END" ? "var(--color-sunken)" : "var(--color-surface)");
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pathway diagram" className="text-ink">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker>
        </defs>
        {links.map((l, i) => {
          if (!pos.has(l.fromKey) || !pos.has(l.toKey)) return null;
          const a = at(l.fromKey), b = at(l.toKey);
          const back = pos.get(l.toKey)!.col <= pos.get(l.fromKey)!.col;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
          const d = back
            ? `M${a.x + W / 2},${a.y + H} C${a.x + W / 2},${a.y + H + 40} ${b.x + W / 2},${b.y + H + 40} ${b.x + W / 2},${b.y + H}`
            : `M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`;
          const lx = back ? (a.x + b.x + W) / 2 : (x1 + x2) / 2, ly = back ? Math.max(a.y, b.y) + H + 30 : (y1 + y2) / 2 - 4;
          return (
            <g key={i} className={l.urgency === "URGENT" ? "text-danger" : "text-muted"}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray={back ? "5 4" : undefined} markerEnd="url(#arr)" />
              {l.share !== 100 && <text x={lx} y={ly} textAnchor="middle" fontSize="11" fill="currentColor" style={{ paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 3 }}>{l.share} %</text>}
            </g>
          );
        })}
        {steps.map((s) => {
          const { x, y } = at(s.key); const place = placeOf(s); const v = volumes?.get(s.key);
          return (
            <g key={s.key}>
              <rect x={x} y={y} width={W} height={H} rx={8} fill={fill(s)} stroke={problems.has(s.key) ? "var(--color-danger)" : "var(--color-line)"} strokeWidth={problems.has(s.key) ? 2 : 1} />
              <text x={x + 10} y={y + 20} fontSize="13" fontWeight={600} fill="currentColor">{clip(s.label, 24)}</text>
              <text x={x + 10} y={y + 37} fontSize="11" fill="var(--color-muted)">{place ? clip(place, 28) : s.kind === "STEP" ? "No place yet" : s.kind === "START" ? "Start" : "End"}</text>
              <text x={x + 10} y={y + 53} fontSize="11" fill="var(--color-muted)">{[s.minutes ? fmtMin(s.minutes) : null, v != null ? `${round(v)} a day` : null].filter(Boolean).join(" · ")}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const round = (v: number) => (v >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());
export const fmtMin = (m: number) => (m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`);
