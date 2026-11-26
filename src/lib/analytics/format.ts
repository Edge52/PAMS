/** How an Analytics KPI is shown (wave 40). Pure, so the cards, the export and the tests agree. */
import { comparable, MIN_N, type Kpi } from "./core";
import { formatMoney, formatNumber } from "../format";

export const NOT_ENOUGH = `Not enough data (n < ${MIN_N})`;

export function formatKpiValue(k: Pick<Kpi, "value" | "unit">): string {
  const v = k.value;
  if (v == null || !Number.isFinite(v)) return "—";
  switch (k.unit) {
    case "share": return `${formatNumber(v * 100, 1)} %`;
    case "days": return `${formatNumber(v, 1)} ${v === 1 ? "day" : "days"}`;
    case "hours": return `${formatNumber(v, 1)} h`;
    case "egp": return formatMoney(v, "EGP", { compact: true });
    default: return formatNumber(v, v % 1 ? 1 : 0);
  }
}

/** A KPI with a benchmark is a comparison: hide it when it rests on fewer than MIN_N items. */
export function kpiShown(k: Pick<Kpi, "n" | "benchmark" | "value">): { show: true } | { show: false; reason: string } {
  if (k.benchmark && !comparable(k.n)) return { show: false, reason: NOT_ENOUGH };
  return { show: true };
}
