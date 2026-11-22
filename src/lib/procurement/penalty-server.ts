import "server-only";
/** Late-delivery penalty of a purchase order (wave 37), from its lines and goods receipts. Rules: ./delay-penalty. */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, deliveryLines, invoices, poLines, purchaseOrders } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { delayPenalty, penaltyTerms, type PenaltyResult } from "./delay-penalty";

export type PoPenalty = PenaltyResult & {
  /** Terms are the order's own (not the hospital defaults). */
  ownTerms: boolean;
  /** Deducted on the order's invoices (not rejected), optionally leaving one invoice out. */
  deducted: number;
};

export async function poDelayPenalty(poId: number, opts: { asOf?: string; exceptInvoiceId?: number } = {}): Promise<PoPenalty | null> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return null;
  const [settings, lines, dels] = await Promise.all([
    getSettings(),
    db.select().from(poLines).where(eq(poLines.poId, poId)).orderBy(asc(poLines.id)),
    db.select().from(deliveries).where(eq(deliveries.poId, poId)).orderBy(asc(deliveries.deliveryDate)),
  ]);
  const dl = dels.length ? await db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, dels.map((d) => d.id))) : [];
  const terms = penaltyTerms(po, { ratePctPerWeek: settings.delayPenaltyRatePct, capPct: settings.delayPenaltyCapPct });
  const result = delayPenalty({
    expectedDelivery: po.expectedDelivery, terms, asOf: opts.asOf ?? todayISO(),
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: num(l.unitPrice) })),
    deliveries: dels.map((d) => ({ date: d.deliveryDate, lines: dl.filter((x) => x.deliveryId === d.id).map((x) => ({ poLineId: x.poLineId, quantity: x.quantity })) })),
    // A cancelled or closed order no longer runs up a penalty on what never came.
    countOutstanding: !["CANCELLED", "CLOSED"].includes(po.status),
  });
  const [{ s }] = await db.select({ s: sql<string>`coalesce(sum(${invoices.delayPenalty}), 0)` }).from(invoices)
    .where(and(eq(invoices.poId, poId), ne(invoices.status, "REJECTED"), opts.exceptInvoiceId ? ne(invoices.id, opts.exceptInvoiceId) : undefined));
  return { ...result, ownTerms: po.delayPenaltyRatePct != null || po.delayPenaltyCapPct != null, deducted: num(s) };
}
