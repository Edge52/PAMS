import "server-only";
/**
 * What happens to the owning record when an approval request ends. The approval engine calls these; the modules
 * never change approval-gated statuses themselves.
 *   PO:    approved → APPROVED (ready to issue);   rejected/withdrawn → back to DRAFT (editable again)
 *   BOQ:   approved → APPROVED (locked);           rejected/withdrawn → back to DRAFT
 *   AWARD: approved → offer AWARDED with the Law 182 art. 39 timeline; rejected → offer unchanged (logged)
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boqs, purchaseOrders } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { applyApprovedAward, committeeChairUserIds, logAwardOutcome } from "@/lib/procurement/tender";
import type { ApprovalEntity } from "./core";

type Ctx = { requestId: number; actor: { id: number; name: string } };

export async function onRequestClosed(entity: ApprovalEntity, entityId: number, status: "APPROVED" | "REJECTED" | "CANCELLED", ctx: Ctx) {
  if (entity === "PO") {
    const to = status === "APPROVED" ? "APPROVED" : "DRAFT";
    const res = await db.update(purchaseOrders).set({ status: to })
      .where(and(eq(purchaseOrders.id, entityId), eq(purchaseOrders.status, "PENDING_APPROVAL"))).returning({ number: purchaseOrders.number });
    if (res.length) await logActivity("po", entityId, "status_changed", `${res[0].number}: pending approval → ${to === "APPROVED" ? "approved, ready to issue" : "draft (can be edited and resubmitted)"}`, ctx.actor.name);
  } else if (entity === "BOQ") {
    const to = status === "APPROVED" ? "APPROVED" : "DRAFT";
    const res = await db.update(boqs).set({ status: to })
      .where(and(eq(boqs.id, entityId), eq(boqs.status, "UNDER_REVIEW"))).returning({ id: boqs.id });
    if (res.length) await logActivity("boq", entityId, "status_changed", `Status UNDER_REVIEW → ${to}${to === "APPROVED" ? " (approval chain complete)" : ""}`, ctx.actor.name);
  } else if (entity === "AWARD") {
    if (status === "APPROVED") await applyApprovedAward(entityId, ctx.actor.name);
    else await logAwardOutcome(entityId, status, ctx.actor.name);
  }
}

/** Chairs of the committee(s) whose recommendation an award request carries (they can't approve it, art. 28). */
export async function awardChairs(offerId: number): Promise<number[]> {
  return committeeChairUserIds(offerId);
}
