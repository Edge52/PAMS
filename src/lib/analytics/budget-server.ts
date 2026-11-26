import "server-only";
/**
 * Analytics › Budget, database side (wave 40). Budget use comes from `budgetRows` (procurement money rules), so the
 * figures match Procurement › Budgets; amounts are converted to EGP with lib/fx (today's rate for the budget and
 * open commitments, the invoice date's rate for last year's monthly pattern).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, facilities, invoiceLines, invoices, purchaseOrders } from "@/db/schema";
import { fiscalYearRange } from "@/lib/fiscal-year";
import { budgetRows, SPENT } from "@/lib/procurement/money-server";
import { loadFx } from "@/lib/server-utils";
import { addToMonth, budgetForecast, budgetTotals, monthsGone, type BudgetLineIn } from "./budget";
import type { Filters } from "./core";

const MAX_LINES = 500;

/** Invoice spend per budget line and budget-year month, EGP at each invoice's date. */
async function monthlySpend(lineIds: number[], startMonth: number): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!lineIds.length) return out;
  const [rows, fx] = await Promise.all([
    db.select({ lineId: purchaseOrders.budgetLineId, date: invoices.invoiceDate, currency: invoices.currency, v: sql<string>`sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice})` })
      .from(invoices).innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id)).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId))
      .where(and(inArray(purchaseOrders.budgetLineId, lineIds), inArray(invoices.status, [...SPENT])))
      .groupBy(purchaseOrders.budgetLineId, invoices.invoiceDate, invoices.currency).limit(20_000),
    loadFx(),
  ]);
  for (const r of rows) {
    if (r.lineId == null) continue;
    const egp = fx.toEgp(Number(r.v), r.currency, r.date);
    if (egp == null) continue;
    const s = out.get(r.lineId) ?? out.set(r.lineId, new Array(12).fill(0)).get(r.lineId)!;
    addToMonth(s, r.date, egp, startMonth);
  }
  return out;
}

export type BudgetAnalytics = Awaited<ReturnType<typeof budgetAnalytics>>;

/** Budget lines of the hospitals for one budget year, with use, forecasts and flags (EGP). */
export async function budgetAnalytics(ids: number[], f: Filters, year: number, startMonth: number, today: string, prefer: "straight" | "seasonal") {
  const range = fiscalYearRange(year, startMonth)!;
  const gone = monthsGone(range.start, range.end, today);
  if (!ids.length) return { range, gone, rows: [], totals: budgetTotals([]), missing: [] as string[], hasSeason: false, truncated: false };
  const dept = f.departmentId ? eq(budgetLines.departmentId, f.departmentId) : undefined;
  const [lines, prior, facs, fx] = await Promise.all([
    db.select().from(budgetLines).where(and(inArray(budgetLines.facilityId, ids), eq(budgetLines.year, year), dept)).orderBy(budgetLines.facilityId, budgetLines.name).limit(MAX_LINES + 1),
    db.select({ id: budgetLines.id, facilityId: budgetLines.facilityId, kind: budgetLines.kind, name: budgetLines.name }).from(budgetLines)
      .where(and(inArray(budgetLines.facilityId, ids), eq(budgetLines.year, year - 1), dept)).limit(MAX_LINES),
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(inArray(facilities.id, ids)),
    loadFx(),
  ]);
  const truncated = lines.length > MAX_LINES;
  const use = await budgetRows(lines.slice(0, MAX_LINES));
  const priorSpend = await monthlySpend(prior.map((p) => p.id), startMonth);
  // Last year's pattern: the line of the same name and kind, else all of that hospital's lines of that kind.
  const key = (fac: number, kind: string, name?: string) => `${fac}|${kind}|${name?.trim().toLowerCase() ?? "*"}`;
  const shapes = new Map<string, number[]>();
  for (const p of prior) {
    const s = priorSpend.get(p.id); if (!s) continue;
    for (const k of [key(p.facilityId, p.kind, p.name), key(p.facilityId, p.kind)]) {
      const acc = shapes.get(k) ?? shapes.set(k, new Array(12).fill(0)).get(k)!;
      s.forEach((v, i) => { acc[i] += v; });
    }
  }
  const missing = new Set<string>();
  const egp = (v: number, cur: string) => { const x = fx.toEgp(v, cur, today); if (x == null) { if (v) missing.add(cur); return 0; } return x; };
  const facName = new Map(facs.map((x) => [x.id, x.name]));
  const input: (BudgetLineIn & { facility: string; currency: string; missingRate: boolean })[] = use.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, facilityId: r.facilityId, facility: facName.get(r.facilityId) ?? "", currency: r.currency, missingRate: r.missingRate,
    amount: egp(Number(r.amount), r.currency), committed: egp(r.committed, r.currency), spent: egp(r.spent, r.currency),
    lastYearMonthly: shapes.get(key(r.facilityId, r.kind, r.name)) ?? shapes.get(key(r.facilityId, r.kind)) ?? null,
  }));
  const rows = budgetForecast(input, gone, prefer).map((r, i) => ({ ...r, facility: input[i].facility, currency: input[i].currency, missingRate: input[i].missingRate }));
  return { range, gone, rows, totals: budgetTotals(rows), missing: [...missing].sort(), hasSeason: rows.some((r) => r.seasonal != null), truncated };
}
