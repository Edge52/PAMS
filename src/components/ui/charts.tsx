/**
 * Small chart kit (wave 21): drawn as SVG on the server, no library. Colours come from the design tokens.
 * Every chart takes a `label` read out by screen readers, and each lists its values in a hidden table-like summary.
 */
import type { ReactNode } from "react";

export type Datum = { label: string; value: number; tone?: "primary" | "gold" | "ok" | "warn" | "danger" | "info" | "muted" };
const COLOR = { primary: "var(--color-primary)", gold: "var(--color-gold)", ok: "var(--color-ok)", warn: "var(--color-warn)", danger: "var(--color-danger)", info: "var(--color-info)", muted: "var(--color-faint)" } as const;
const CYCLE: (keyof typeof COLOR)[] = ["primary", "gold", "info", "ok", "warn", "danger", "muted"];
const fmt = (n: number) => n.toLocaleString("en");
const summary = (data: Datum[]) => data.map((d) => `${d.label}: ${fmt(d.value)}`).join("; ");

/** Horizontal bars, one per item, longest first when `sort` is set. Best for comparing 3 to 12 items. */
export function BarList({ data, label, sort = false, format = fmt }: { data: Datum[]; label: string; sort?: boolean; format?: (n: number) => ReactNode }) {
  const rows = sort ? [...data].sort((a, b) => b.value - a.value) : data;
  const max = Math.max(1, ...rows.map((d) => d.value));
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{d.label}</span>
          <span aria-hidden className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%`, background: COLOR[d.tone ?? "primary"] }} /></span>
          <span className="tabular-nums font-semibold">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ring split into parts of a whole, with the total in the middle and a legend beside it. Up to 6 parts. */
export function Donut({ data, label, total, caption }: { data: Datum[]; label: string; total?: ReactNode; caption?: string }) {
  const sum = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  const parts = data.map((d, i) => ({ d, i, len: (d.value / sum) * C, off: data.slice(0, i).reduce((t, x) => t + (x.value / sum) * C, 0) }));
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 120 120" width="148" height="148" role="img" aria-label={`${label}. ${summary(data)}`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-sunken)" strokeWidth="14" />
        {parts.map(({ d, i, len, off }) => (
          <circle key={d.label} cx="60" cy="60" r={R} fill="none" stroke={COLOR[d.tone ?? CYCLE[i % CYCLE.length]]} strokeWidth="14"
            strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />
        ))}
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" fontSize="22" fill="var(--color-ink)" style={{ fontFamily: "var(--font-display)" }}>{total ?? fmt(sum)}</text>
        {caption && <text x="60" y="78" textAnchor="middle" fontSize="8" fill="var(--color-muted)">{caption}</text>}
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: COLOR[d.tone ?? CYCLE[i % CYCLE.length]] }} />{d.label}</span>
            <span className="tabular-nums font-semibold">{fmt(d.value)} <span className="font-normal text-muted">{Math.round((d.value / sum) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small trend line for a figure card: values in time order. No axes; the label says what it shows. */
export function Sparkline({ values, label, tone = "primary", width = 120, height = 32 }: { values: number[]; label: string; tone?: keyof typeof COLOR; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4), y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}: from ${fmt(values[0])} to ${fmt(values.at(-1)!)}`}>
      <path d={d} fill="none" stroke={COLOR[tone]} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="2.5" fill={COLOR[tone]} />
    </svg>
  );
}

/** Upright bars over time (months, weeks), with the value above each bar and its label below. Up to about 12 bars. */
export function Columns({ data, label, height = 150 }: { data: Datum[]; label: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 44, G = 14, top = 18, base = height - 22, width = data.length * (W + G) + G;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={`${label}, scrolls sideways when wide`}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}. ${summary(data)}`}>
        <line x1="0" x2={width} y1={base} y2={base} stroke="var(--color-line)" />
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / max) * (base - top)), x0 = G + i * (W + G);
          return (
            <g key={d.label}>
              <rect x={x0} y={base - h} width={W} height={h} rx="5" fill={COLOR[d.tone ?? "primary"]} />
              <text x={x0 + W / 2} y={base - h - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-ink)">{fmt(d.value)}</text>
              <text x={x0 + W / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
