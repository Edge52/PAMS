/**
 * Reports for people without price access (audit R9, wave 40): money columns (`money`, `egp`) and money figures in
 * the summary are taken out, on screen and in the Excel file. Ratios such as COSR stay. Pure.
 */
import type { ReportResult } from "./types";

export const PRICES_HIDDEN_NOTE = "Amounts are hidden: they are shown only to people who may see prices.";

export function hidePrices(r: ReportResult): ReportResult {
  const money = (t: string | undefined) => t === "money" || t === "egp";
  const had = r.sections.some((s) => s.columns.some((c) => money(c.type))) || (r.summary ?? []).some((x) => x.money);
  if (!had) return r;
  return {
    ...r,
    summary: r.summary?.filter((x) => !x.money),
    sections: r.sections.map((s) => {
      const gone = new Set(s.columns.filter((c) => money(c.type)).map((c) => c.key));
      const strip = <T extends Record<string, unknown>>(row: T): T => Object.fromEntries(Object.entries(row).filter(([k]) => !gone.has(k))) as T;
      return { ...s, columns: s.columns.filter((c) => !gone.has(c.key)), rows: s.rows.map(strip), totals: s.totals ? strip(s.totals) : undefined };
    }),
    notes: [...(r.notes ?? []), PRICES_HIDDEN_NOTE],
  };
}
