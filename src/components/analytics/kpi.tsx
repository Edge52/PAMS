import Link from "next/link";
import type { ReactNode } from "react";
import { HIDDEN_PRICE, seesPrices } from "@/lib/auth/prices";
import { getCurrentUser } from "@/lib/auth/session";
import type { Kpi } from "@/lib/analytics/core";
import { formatKpiValue, kpiShown } from "@/lib/analytics/format";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * One Analytics figure with what it rests on (wave 40): the value, its formula, the period and the count, and the
 * benchmark with its source. A comparison on fewer than 5 items says "Not enough data (n < 5)" instead of a value.
 * Money is hidden from people who may not see prices.
 */
export async function KpiCard({ kpi, period, href, tone }: {
  kpi: Kpi; period: { from: string; to: string }; href?: string; tone?: "ok" | "warn" | "danger";
}) {
  const me = await getCurrentUser();
  const shown = kpiShown(kpi);
  const hidden = kpi.unit === "egp" && !seesPrices(me?.role);
  const value = hidden ? HIDDEN_PRICE : shown.show ? formatKpiValue(kpi) : null;
  const toneCls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "";
  const body = (
    <>
      <p className="flex items-start justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {kpi.label}{href && <span aria-hidden className="text-faint group-hover:text-primary">›</span>}
      </p>
      {value != null
        ? <p className={`mt-1 font-display text-[26px] leading-none [overflow-wrap:anywhere] sm:text-[30px] ${shown.show && !hidden ? toneCls : ""}`}>{value}</p>
        : <p className="mt-2 text-sm font-semibold text-muted">{shown.show ? "" : shown.reason}</p>}
      <dl className="mt-2 space-y-0.5 text-[12px] text-muted">
        <div><dt className="sr-only">Formula</dt><dd>{kpi.formula}</dd></div>
        <div><dt className="inline">Period: </dt><dd className="inline">{formatDate(period.from)} – {formatDate(period.to)}</dd>
          <span aria-hidden> · </span><dt className="inline">n = </dt><dd className="inline tabular-nums">{formatNumber(kpi.n)}</dd></div>
        {kpi.benchmark && (
          <div><dt className="inline">Benchmark: </dt><dd className="inline">{kpi.benchmark.text} <span className="text-faint">({kpi.benchmark.source})</span></dd></div>
        )}
      </dl>
    </>
  );
  const cls = "block min-w-0 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-4 shadow-[var(--shadow-card)]";
  return href ? <Link href={href} className={`${cls} group hover:border-primary`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A responsive grid of KPI cards. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
