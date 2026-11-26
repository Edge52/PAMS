/** Stand-in (wave 40, agent F) for agent E's KPI card: the lead keeps E's version at merge. */
import type { ReactNode } from "react";
import { comparable, type Kpi } from "@/lib/analytics/core";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

export function KpiCard({ kpi, period }: { kpi: Kpi; period: { from: string; to: string } }) {
  const v = kpi.value;
  const text = kpi.benchmark && !comparable(kpi.n) ? "Not enough data" : v == null ? "—"
    : kpi.unit === "share" ? `${formatNumber(v * 100, 1)} %` : kpi.unit === "egp" ? formatMoney(v, "EGP", { compact: true })
    : kpi.unit === "days" ? `${formatNumber(v, 1)} days` : kpi.unit === "hours" ? `${formatNumber(v, 1)} h` : formatNumber(v, 1);
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-4">
      <p className="text-sm text-muted">{kpi.label}</p>
      <p className="mt-1 font-display text-[26px] leading-none">{text}</p>
      <p className="mt-2 text-xs text-muted">{kpi.formula} · {formatDate(period.from)} – {formatDate(period.to)} · n = {formatNumber(kpi.n)}</p>
      {kpi.benchmark && <p className="text-xs text-muted">Benchmark: {kpi.benchmark.text} ({kpi.benchmark.source})</p>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
