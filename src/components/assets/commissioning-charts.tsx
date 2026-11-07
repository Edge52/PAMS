/**
 * Commissioning charts (wave 14): the progress curve and the Gantt by floor and department. Plain SVG and HTML,
 * rendered on the server, so they print and need no script.
 */
import Link from "next/link";
import type { CurvePoint, GanttRow } from "@/lib/assets/commissioning";
import { formatDate } from "@/lib/format";

const STAGE_VARS = ["var(--color-muted)", "var(--color-warn)", "var(--color-info)", "var(--color-ok)"] as const;
const SERIES = [{ i: 0, label: "Handed over", color: STAGE_VARS[1] }, { i: 1, label: "Installed", color: STAGE_VARS[2] }, { i: 2, label: "Accepted", color: STAGE_VARS[3] }] as const;
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Rooms handed over, installed and accepted by week: the plan dashed, what happened solid. */
export function CommissioningCurve({ points, total, today }: { points: CurvePoint[]; total: number; today: string }) {
  if (points.length < 2 || !total) return null;
  const W = 760, H = 230, L = 36, R = 12, T = 10, B = 28;
  const x = (i: number) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (n: number) => T + (1 - n / total) * (H - T - B);
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  const ti = points.findIndex((p) => p.week > today) - 1;
  const step = Math.max(1, Math.ceil(points.length / 10));
  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px] w-full" role="img" aria-label="Rooms handed over, installed and accepted each week, planned and actual">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}><line x1={L} x2={W - R} y1={y(total * f)} y2={y(total * f)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={L - 6} y={y(total * f) + 4} textAnchor="end" fontSize={10} fill="var(--color-muted)">{Math.round(total * f)}</text></g>
        ))}
        {points.map((p, i) => i % step === 0 && <text key={p.week} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-muted)">{short(p.week)}</text>)}
        {ti >= 0 && ti < points.length - 1 && <g><line x1={x(ti + 0.5)} x2={x(ti + 0.5)} y1={T} y2={H - B} stroke="var(--color-danger)" strokeDasharray="3 3" /><text x={x(ti + 0.5) + 3} y={T + 10} fontSize={10} fill="var(--color-danger)">today</text></g>}
        {SERIES.map((s) => (
          <g key={s.label}>
            <polyline points={line(points.map((p) => p.planned[s.i]))} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.8} />
            <polyline points={line(points.map((p) => p.actual?.[s.i] ?? null))} fill="none" stroke={s.color} strokeWidth={2.5} />
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {SERIES.map((s) => <span key={s.label} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: s.color }} />{s.label}</span>)}
        <span>Dashed: planned. Solid: actual, to today. Out of {total} rooms.</span>
      </figcaption>
    </figure>
  );
}

/** The Gantt: one row per floor and department, planned window as bars, progress as a count. */
export function CommissioningGantt({ rows, weeks, today, awaiting, roomsHref }: {
  rows: GanttRow[]; weeks: string[]; today: string;
  /** Devices ordered by the project and not yet received, per row key (floor|department). */
  awaiting?: Map<string, number>;
  /** Link for a row's rooms (e.g. the room table filtered to that floor). */
  roomsHref?: (r: GanttRow) => string;
}) {
  if (!rows.length || weeks.length < 2) return null;
  const first = Date.parse(`${weeks[0]}T00:00:00Z`), last = Date.parse(`${weeks[weeks.length - 1]}T00:00:00Z`) + 7 * 86_400_000;
  const pct = (d: string | null) => (d == null ? null : Math.max(0, Math.min(100, ((Date.parse(`${d}T00:00:00Z`) - first) / (last - first)) * 100)));
  const seg = (from: string | null, to: string | null, color: string, title: string) => {
    const a = pct(from), b = pct(to);
    if (a == null || b == null) return null;
    return <span title={title} className="absolute top-1 h-3 rounded-sm" style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%`, background: color, opacity: 0.85 }} />;
  };
  const todayPct = pct(today);
  const step = Math.max(1, Math.ceil(weeks.length / 12));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] text-xs">
        <div className="flex border-b border-line pb-1 text-muted">
          <div className="w-56 shrink-0">Floor · department</div>
          <div className="relative h-4 flex-1">{weeks.map((w, i) => i % step === 0 && <span key={w} className="absolute -translate-x-1/2" style={{ left: `${pct(w)}%` }}>{short(w)}</span>)}</div>
          <div className="w-24 shrink-0 text-right">Accepted</div>
        </div>
        {rows.map((r, i) => {
          const floorHead = i === 0 || r.floor !== rows[i - 1].floor;
          const wait = awaiting?.get(r.key) ?? 0;
          return (
            <div key={r.key}>
              {floorHead && <div className="mt-2 font-semibold">{r.floor}</div>}
              <div className="flex items-center border-b border-line/60 py-0.5">
                <div className="w-56 shrink-0 truncate pr-2" title={`${r.label}: ${r.rooms} room${r.rooms === 1 ? "" : "s"}`}>
                  {roomsHref ? <Link href={roomsHref(r)} className="text-primary hover:underline">{r.label}</Link> : r.label} <span className="text-muted">({r.rooms})</span>
                </div>
                <div className="relative h-5 flex-1 rounded bg-sunken/60">
                  {seg(r.planned.from, r.planned.handover, STAGE_VARS[1], `Handover ${r.planned.from ? formatDate(r.planned.from) : "?"} – ${r.planned.handover ? formatDate(r.planned.handover) : "?"}`)}
                  {seg(r.planned.handover, r.planned.installed, STAGE_VARS[2], `Installation to ${r.planned.installed ? formatDate(r.planned.installed) : "?"}`)}
                  {seg(r.planned.installed, r.planned.to, STAGE_VARS[3], `Acceptance to ${r.planned.to ? formatDate(r.planned.to) : "?"}`)}
                  {r.actual.accepted && pct(r.actual.accepted) != null && <span title={`All accepted ${formatDate(r.actual.accepted)}`} className="absolute top-0 h-5 w-1 rounded-sm bg-ink" style={{ left: `${pct(r.actual.accepted)}%` }} />}
                  {todayPct != null && todayPct > 0 && todayPct < 100 && <span aria-hidden className="absolute top-0 h-5 w-px bg-danger" style={{ left: `${todayPct}%` }} />}
                </div>
                <div className="w-24 shrink-0 text-right">
                  <span className={r.actual.done === r.actual.total ? "font-semibold text-ok" : ""}>{r.actual.done}/{r.actual.total}</span>
                  {r.late > 0 && <span className="block font-semibold text-danger">{r.late} late</span>}
                  {wait > 0 && <span className="block text-warn" title="Devices the project has ordered for this department and not yet received">{wait} on order</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
          {SERIES.map((s, i) => <span key={s.label} className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm" style={{ background: s.color }} />{["Planned handovers", "Planned installation", "Planned acceptance"][i]}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-1 rounded-sm bg-ink" />All rooms accepted</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-danger" />Today</span>
        </div>
      </div>
    </div>
  );
}
