import "server-only";
/**
 * What happens to the owning record when an approval request ends. The approval engine calls these; the modules
 * never change approval-gated statuses themselves.
 *   PO:    approved → APPROVED (ready to issue);   rejected/withdrawn → back to DRAFT (editable again)
 *   BOQ:   approved → APPROVED (locked);           rejected/withdrawn → back to DRAFT
 *   AWARD: approved → offer AWARDED with the Law 182 art. 39 timeline; rejected → offer unchanged (logged)
 *   DISPOSAL: approved → disposal APPROVED, asset condemned and out of service; rejected → REJECTED; withdrawn → DRAFT
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, assets, boqs, disposals, offers, purchaseOrders } from "@/db/schema";
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

/**
 * Repair pass (audit DL-24/DL-25). Closing a request and applying its effect are separate writes; if the server stops
 * between them, the record would stay "pending approval" for ever. This re-applies the effect of requests that ended
 * in the last 30 days but whose record still waits — every effect above is a conditional update, so running it again
 * is safe. Awards are only re-applied when the offer hasn't changed since the decision (a revoked award stays revoked).
 * Runs with the hourly alert run. Returns how many records it repaired.
 */
export async function reconcileApprovalEffects(): Promise<number> {
  const ended = await db.select().from(approvalRequests)
    .where(and(inArray(approvalRequests.status, ["APPROVED", "REJECTED"]), gte(approvalRequests.decidedAt, sql`now() - interval '30 days'`)))
    .orderBy(desc(approvalRequests.decidedAt));
  const seen = new Set<string>();
  let fixed = 0;
  for (const r of ended) {
    const key = `${r.entity}:${r.entityId}`;
    if (seen.has(key)) continue; // only the latest ended request per record
    seen.add(key);
    const [open] = await db.select({ id: approvalRequests.id }).from(approvalRequests)
      .where(and(eq(approvalRequests.entity, r.entity), eq(approvalRequests.entityId, r.entityId), eq(approvalRequests.status, "PENDING"))).limit(1);
    if (open) continue;
    let stuck = false;
    if (r.entity === "PO") stuck = (await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.id, r.entityId), eq(purchaseOrders.status, "PENDING_APPROVAL")))).length > 0;
    else if (r.entity === "BOQ") stuck = (await db.select({ id: boqs.id }).from(boqs).where(and(eq(boqs.id, r.entityId), eq(boqs.status, "UNDER_REVIEW")))).length > 0;
    else if (r.entity === "DISPOSAL") stuck = (await db.select({ id: disposals.id }).from(disposals).where(and(eq(disposals.id, r.entityId), eq(disposals.status, "PENDING_APPROVAL")))).length > 0;
    else if (r.entity === "AWARD" && r.status === "APPROVED" && r.decidedAt) {
      stuck = (await db.select({ id: offers.id }).from(offers).where(and(eq(offers.id, r.entityId), ne(offers.status, "AWARDED"),
        isNull(offers.awardApprovedOn), lte(offers.updatedAt, r.decidedAt)))).length > 0;
    }
    if (!stuck) continue;
    await onRequestClosed(r.entity, r.entityId, r.status as "APPROVED" | "REJECTED", { requestId: r.id, actor: { id: 0, name: "System (repair)" } });
    fixed++;
  }
  return fixed;
}
