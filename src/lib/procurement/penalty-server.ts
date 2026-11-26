import "server-only";
/** Late-delivery penalty of a purchase order (wave 37), from its lines and goods receipts. Rules: ./delay-penalty. */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, deliveryLines, invoices, poLines, poPenaltyTerms, purchaseOrders } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { delayPenalty, deliveryPeriodDays, penaltyTerms, rulesFromSettings, type PenaltyResult } from "./delay-penalty";

export type PoPenalty = PenaltyResult & {
  /** The order has its own rate or cap (not the hospital rules). */
  ownTerms: boolean;
  /** The contract type was set on the order (otherwise supply by default). */
  typeSet: boolean;
  waivedByName: string | null;
  waivedAt: Date | null;
  /** Deducted on the order's invoices (not rejected), optionally leaving one invoice out. */
  deducted: number;
};

export async function poDelayPenalty(poId: number, opts: { asOf?: string; exceptInvoiceId?: number } = {}): Promise<PoPenalty | null> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return null;
  const [settings, lines, dels, [extra]] = await Promise.all([
    getSettings(),
    db.select().from(poLines).where(eq(poLines.poId, poId)).orderBy(asc(poLines.id)),
    db.select().from(deliveries).where(eq(deliveries.poId, poId)).orderBy(asc(deliveries.deliveryDate)),
    db.select().from(poPenaltyTerms).where(eq(poPenaltyTerms.poId, poId)),
  ]);
  const dl = dels.length ? await db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, dels.map((d) => d.id))) : [];
  // Delivery period: issue date (else the day the order was made) to the expected delivery.
  const issued = po.issueDate ?? todayISO(po.createdAt);
  const terms = penaltyTerms({ ...po, contractType: extra?.contractType, blocksUse: extra?.blocksUse }, rulesFromSettings(settings), deliveryPeriodDays(issued, po.expectedDelivery));
  const result = delayPenalty({
    expectedDelivery: po.expectedDelivery, terms, asOf: opts.asOf ?? todayISO(),
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: num(l.unitPrice) })),
    deliveries: dels.map((d) => ({ date: d.deliveryDate, lines: dl.filter((x) => x.deliveryId === d.id).map((x) => ({ poLineId: x.poLineId, quantity: x.quantity })) })),
    // A cancelled or closed order no longer runs up a penalty on what never came.
    countOutstanding: !["CANCELLED", "CLOSED"].includes(po.status),
    waivedReason: extra?.waivedReason,
  });
  const [{ s }] = await db.select({ s: sql<string>`coalesce(sum(${invoices.delayPenalty}), 0)` }).from(invoices)
    .where(and(eq(invoices.poId, poId), ne(invoices.status, "REJECTED"), opts.exceptInvoiceId ? ne(invoices.id, opts.exceptInvoiceId) : undefined));
  return {
    ...result, ownTerms: po.delayPenaltyRatePct != null || po.delayPenaltyCapPct != null, typeSet: extra?.contractType != null,
    waivedByName: extra?.waivedByName ?? null, waivedAt: extra?.waivedAt ?? null, deducted: num(s),
  };
}
