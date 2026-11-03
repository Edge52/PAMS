import "server-only";
/**
 * Money on the server (wave 10): PO values, budget use per line, and the data an invoice is matched against.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, invoiceLines, invoices, poLines, purchaseOrders } from "@/db/schema";
import { budgetUse, type MatchLine } from "./money";
import { fxFactors } from "./server";

/** POs that commit money: approved onwards, not cancelled. */
export const COMMITTING = ["APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"] as const;
/** Invoices that count as spent. */
export const SPENT = ["APPROVED", "PAID"] as const;

export async function poValues(poIds: number[]): Promise<Map<number, number>> {
  if (!poIds.length) return new Map();
  const rows = await db.select({ poId: poLines.poId, v: sql<string>`sum(${poLines.quantity} * ${poLines.unitPrice})` }).from(poLines)
    .where(inArray(poLines.poId, poIds)).groupBy(poLines.poId);
  return new Map(rows.map((r) => [r.poId, Number(r.v)]));
}

async function invoicedPerPo(poIds: number[], statuses: readonly string[]) {
  if (!poIds.length) return new Map<number, number>();
  const rows = await db.select({ poId: invoices.poId, v: sql<string>`sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice})` }).from(invoices)
    .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
    .where(and(inArray(invoices.poId, poIds), inArray(invoices.status, statuses as unknown as ("APPROVED" | "PAID")[]))).groupBy(invoices.poId);
  return new Map(rows.map((r) => [r.poId, Number(r.v)]));
}

export type BudgetRow = typeof budgetLines.$inferSelect & {
  committed: number; spent: number; requested: number; used: number; remaining: number; pct: number; level: "OK" | "WARN" | "OVER"; pos: number; missingRate: boolean;
};

/**
 * Budget use per line, in the line's currency: committed = approved POs not yet invoiced, spent = approved or paid
 * invoices, requested = POs waiting for approval (shown, not counted).
 */
export async function budgetRows(lines: (typeof budgetLines.$inferSelect)[]): Promise<BudgetRow[]> {
  if (!lines.length) return [];
  const pos = await db.select({ id: purchaseOrders.id, lineId: purchaseOrders.budgetLineId, status: purchaseOrders.status, currency: purchaseOrders.currency }).from(purchaseOrders)
    .where(and(inArray(purchaseOrders.budgetLineId, lines.map((l) => l.id)), ne(purchaseOrders.status, "CANCELLED")));
  const ids = pos.map((p) => p.id);
  const [values, spent] = await Promise.all([poValues(ids), invoicedPerPo(ids, SPENT)]);
  const out: BudgetRow[] = [];
  for (const l of lines) {
    const mine = pos.filter((p) => p.lineId === l.id);
    const fx = await fxFactors(mine.map((p) => p.currency), l.currency);
    let committed = 0, sp = 0, requested = 0, missingRate = false;
    for (const p of mine) {
      const f = fx[p.currency]; if (f == null) { missingRate = true; continue; }
      const v = (values.get(p.id) ?? 0) * f, s = (spent.get(p.id) ?? 0) * f;
      if ((COMMITTING as readonly string[]).includes(p.status)) { sp += s; committed += Math.max(0, v - s); }
      else if (p.status === "PENDING_APPROVAL" || p.status === "DRAFT") requested += v;
    }
    const u = budgetUse(Number(l.amount), committed, sp);
    out.push({ ...l, committed, spent: sp, requested, used: u.used, remaining: u.remaining, pct: u.pct, level: u.level, pos: mine.length, missingRate });
  }
  return out;
}

/** The match lines of a PO for a new or existing invoice (`quantities` keyed by PO line; others invoiced exclude `invoiceId`). */
export async function matchLinesFor(poId: number, entered: Map<number, { quantity: number; unitPrice: number }>, invoiceId?: number): Promise<MatchLine[]> {
  const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
  const before = await db.select({ poLineId: invoiceLines.poLineId, q: sql<number>`sum(${invoiceLines.quantity})::int` }).from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.poId, poId), ne(invoices.status, "REJECTED"), invoiceId ? ne(invoices.id, invoiceId) : undefined)).groupBy(invoiceLines.poLineId);
  const prev = new Map(before.map((b) => [b.poLineId, b.q]));
  return lines.map((l) => ({
    poLineId: l.id, description: l.description, ordered: l.quantity, received: l.receivedQty, poUnitPrice: Number(l.unitPrice),
    invoicedBefore: prev.get(l.id) ?? 0, quantity: entered.get(l.id)?.quantity ?? 0, unitPrice: entered.get(l.id)?.unitPrice ?? Number(l.unitPrice),
  }));
}
