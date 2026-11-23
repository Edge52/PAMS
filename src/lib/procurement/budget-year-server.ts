import "server-only";
/** The hospital's budget (fiscal) year setting, for pages and actions (wave 38). Rules are in lib/fiscal-year. */
import { cleanStartMonth, fiscalYearLabel, fiscalYearOf } from "@/lib/fiscal-year";
import { todayISO } from "@/lib/format";
import { getSetting } from "@/lib/settings";

export type BudgetYear = { startMonth: number; current: number; label: (year: number) => string };

/** The start month, the current budget year (Cairo date) and a labeller ("FY 2026/27"). */
export async function budgetYear(now: Date = new Date()): Promise<BudgetYear> {
  const startMonth = cleanStartMonth(await getSetting("budgetYearStartMonth"));
  return { startMonth, current: fiscalYearOf(todayISO(now), startMonth), label: (y: number) => fiscalYearLabel(y, startMonth) };
}
