import "server-only";
/**
 * What happens to the owning record when an approval request ends. The approval engine calls these; the modules
 * never change approval-gated statuses themselves.
 *   PO:    approved → APPROVED (ready to issue);   rejected/withdrawn → back to DRAFT (editable again)
 *   BOQ:   approved → APPROVED (locked);           rejected/withdrawn → back to DRAFT
 *   AWARD: approved → offer AWARDED with the Law 182 art. 39 timeline; rejected → offer unchanged (logged)
 *   DISPOSAL: approved → disposal APPROVED, asset condemned and out of service; rejected → REJECTED; withdrawn → DRAFT
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, boqs, disposals, purchaseOrders } from "@/db/schema";
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
  } else if (entity === "DISPOSAL") {
    const to = status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : "DRAFT";
    const res = await db.update(disposals).set({ status: to, decidedAt: status === "CANCELLED" ? null : new Date() })
      .where(and(eq(disposals.id, entityId), eq(disposals.status, "PENDING_APPROVAL"))).returning({ number: disposals.number, assetId: disposals.assetId });
    if (!res.length) return;
    await logActivity("disposal", entityId, "status_changed", `${res[0].number}: ${to === "APPROVED" ? "condemnation approved" : to === "REJECTED" ? "condemnation rejected" : "withdrawn, back to draft"}`, ctx.actor.name);
    if (to === "APPROVED") {
      // Condemned: out of service and marked so; the asset is written off when the disposal is recorded as done.
      await db.update(assets).set({ status: "OUT_OF_SERVICE", condition: "CONDEMNED" }).where(eq(assets.id, res[0].assetId));
      await logActivity("asset", res[0].assetId, "condemned", `Condemned under ${res[0].number}; awaiting disposal`, ctx.actor.name);
    }
  }
}

/** Chairs of the committee(s) whose recommendation an award request carries (they can't approve it, art. 28). */
export async function awardChairs(offerId: number): Promise<number[]> {
  return committeeChairUserIds(offerId);
}
