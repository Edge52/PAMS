import "server-only";
import { and, asc, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { formatMoney, num } from "@/lib/format";
import { humanize } from "@/lib/status";
import { daysLate, sumKey, sumToEgp, toEgp, plural } from "./calc";
import { EGP_NOTE, facilityCond, missingRatesNote, ratesFor } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/** Statuses that are no longer open. Everything else (draft, pending approval, approved, issued…) is listed. */
export const PO_CLOSED = ["DELIVERED", "CLOSED", "CANCELLED"] as const;

export async function openPurchaseOrdersReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const list = await db.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
    issueDate: purchaseOrders.issueDate, expectedDelivery: purchaseOrders.expectedDelivery,
    supplier: suppliers.name, facility: facilities.name,
    value: sql<string>`coalesce(sum(${poLines.quantity} * ${poLines.unitPrice}), 0)`,
    ordered: sql<number>`coalesce(sum(${poLines.quantity}), 0)::int`,
    received: sql<number>`coalesce(sum(${poLines.receivedQty}), 0)::int`,
  }).from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
    .leftJoin(poLines, eq(poLines.poId, purchaseOrders.id))
    .where(and(
      notInArray(purchaseOrders.status, [...PO_CLOSED]),
      facilityCond(purchaseOrders.facilityId, f, scope, true),
      f.from ? gte(purchaseOrders.expectedDelivery, f.from) : undefined,
      f.to ? lte(purchaseOrders.expectedDelivery, f.to) : undefined,
    ))
    .groupBy(purchaseOrders.id, suppliers.name, facilities.name)
    .orderBy(sql`${purchaseOrders.expectedDelivery} asc nulls last`, asc(purchaseOrders.number));

  const rates = await ratesFor(list.map((p) => p.currency));
  const rows: Row[] = list.map((p) => {
    const value = num(p.value);
    const late = daysLate(p.expectedDelivery, today, p.ordered > 0 && p.received >= p.ordered);
    return {
      id: p.id, number: p.number, supplier: p.supplier, facility: p.facility, status: humanize(p.status),
      issueDate: p.issueDate, expectedDelivery: p.expectedDelivery, daysLate: late,
      ordered: p.ordered, received: p.received, outstanding: Math.max(0, p.ordered - p.received),
      currency: p.currency, value, valueEgp: toEgp(value, p.currency, rates),
    };
  });
  const totals = sumToEgp(list.map((p) => ({ amount: num(p.value), currency: p.currency })), rates);
  const lateCount = rows.filter((r) => typeof r.daysLate === "number" && r.daysLate > 0).length;

  return {
    summary: [
      { label: "Open orders", value: String(rows.length) },
      { label: "Late", value: String(lateCount) },
      { label: "Open value", value: formatMoney(totals.egp, "EGP", { compact: true }) },
      ...Object.entries(totals.byCurrency).filter(([c]) => c !== "EGP").map(([c, v]) => ({ label: `In ${c}`, value: formatMoney(v, c, { compact: true }) })),
    ],
    sections: [{
      key: "orders",
      columns: [
        { key: "number", header: "PO", width: 16, mono: true, href: (r) => `/procurement/purchase-orders/${r.id}` },
        { key: "supplier", header: "Supplier", width: 30 },
        { key: "facility", header: "Facility", width: 26 },
        { key: "status", header: "Status", width: 18 },
        { key: "issueDate", header: "Issued", type: "date", width: 13 },
        { key: "expectedDelivery", header: "Expected delivery", type: "date", width: 14 },
        { key: "daysLate", header: "Days late", type: "days", width: 10, tone: (r) => (typeof r.daysLate === "number" && r.daysLate > 0 ? "danger" : null) },
        { key: "ordered", header: "Ordered", type: "int", width: 10 },
        { key: "received", header: "Received", type: "int", width: 10 },
        { key: "outstanding", header: "Outstanding", type: "int", width: 12 },
        { key: "value", header: "Value", type: "money", currencyKey: "currency", width: 18 },
        { key: "currency", header: "Currency", width: 9, only: "excel" },
        { key: "valueEgp", header: "Value (EGP)", type: "egp", width: 18 },
      ],
      rows,
      totals: rows.length ? {
        number: plural(rows.length, "order"), ordered: sumKey(rows, "ordered"), received: sumKey(rows, "received"),
        outstanding: sumKey(rows, "outstanding"), valueEgp: totals.egp,
      } : undefined,
      empty: "No open purchase orders match these filters.",
    }],
    notes: [EGP_NOTE, "Days late counts from the expected delivery date until every ordered unit is received.", missingRatesNote(totals.missing)]
      .filter((x): x is string => !!x),
  };
}
