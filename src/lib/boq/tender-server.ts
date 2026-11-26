import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqDepartments, boqLines, deviceTypes, offerLines, offers, poLines, purchaseOrders, rfqLines, rfqs } from "@/db/schema";
import { planVsOrdered, tenderedLines, type HandoffLine, type OrderedLine } from "./tender-handoff";

export type TenderLine = HandoffLine & { tier: string; explanation: string | null };

/** The BOQ's lines with device type and department, for picking. */
export async function handoffLines(boqId: number): Promise<TenderLine[]> {
  return db.select({
    id: boqLines.id, deviceTypeId: boqLines.deviceTypeId, deviceCode: deviceTypes.code, deviceName: deviceTypes.name,
    quantity: boqLines.quantity, department: boqDepartments.label, tier: boqLines.tier, explanation: boqLines.calcExplanation,
  }).from(boqLines).innerJoin(deviceTypes, eq(deviceTypes.id, boqLines.deviceTypeId))
    .leftJoin(boqDepartments, eq(boqDepartments.id, boqLines.boqDepartmentId))
    .where(eq(boqLines.boqId, boqId)).orderBy(asc(deviceTypes.code), asc(boqLines.id));
}

/** RFQs (not cancelled) made from this BOQ, with the BOQ lines each asks for. */
export async function boqRfqLines(boqId: number) {
  return db.select({ rfqId: rfqs.id, rfqNumber: rfqs.number, status: rfqs.status, boqLineIds: rfqLines.boqLineIds })
    .from(rfqLines).innerJoin(rfqs, eq(rfqs.id, rfqLines.rfqId))
    .where(and(eq(rfqs.boqId, boqId), ne(rfqs.status, "CANCELLED")));
}

/** Plan vs ordered for a BOQ: planned quantity, in an RFQ, ordered and received, per device type. */
export async function boqPlanVsOrdered(boqId: number, lines?: HandoffLine[]) {
  const all = lines ?? await handoffLines(boqId);
  const tenderRows = await boqRfqLines(boqId);
  const lineIds = all.map((l) => l.id);
  const rfqIds = [...new Set(tenderRows.map((r) => r.rfqId))];
  const ordered: OrderedLine[] = lineIds.length
    ? await db.select({ boqLineId: offerLines.boqLineId, deviceTypeId: poLines.deviceTypeId, quantity: poLines.quantity, received: poLines.receivedQty })
      .from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .innerJoin(offerLines, eq(offerLines.id, poLines.offerLineId)).innerJoin(offers, eq(offers.id, offerLines.offerId))
      .where(and(ne(purchaseOrders.status, "CANCELLED"),
        or(inArray(offerLines.boqLineId, lineIds), rfqIds.length ? sql`(${offerLines.boqLineId} is null and ${inArray(offers.rfqId, rfqIds)})` : sql`false`)))
    : [];
  return { rows: planVsOrdered(all, tenderedLines(tenderRows), ordered), rfqs: [...new Map(tenderRows.map((r) => [r.rfqId, { id: r.rfqId, number: r.rfqNumber, status: r.status }])).values()] };
}
