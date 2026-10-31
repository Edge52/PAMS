import "server-only";
/**
 * Approval engine — database side. The rules live in core.ts (pure, tested); this file loads, saves, notifies and
 * calls back into the owning module when a request ends (effects.ts).
 *
 * Every function takes an optional `actor` (the signed-in user by default) so seeds and scripts can drive the same
 * code without a browser session.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalPolicies, approvalRequests, approvalSteps, notifications, users } from "@/db/schema";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { facilityScope, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { notifyUsers, usersWithRole } from "@/lib/notifications";
import { formatMoney, num } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";
import { getSetting } from "@/lib/settings";
import {
  advance, buildSteps, canDecide, canRecordPaper, isMemberStep,
  type ApprovalEntity, type CommitteeMemberInput, type Policy, type StepState, type Verdict,
} from "./core";
import { awardChairs, onRequestClosed } from "./effects";

export type Actor = Pick<CurrentUser, "id" | "name" | "role" | "allFacilities">;
export type Result = { ok: true; message: string } | { ok: false; error: string };

/** Activity-log entity for each approval entity (the record the trail belongs to). */
export const LOG_ENTITY: Record<ApprovalEntity, string> = { PO: "po", BOQ: "boq", AWARD: "offer" };
const ENTITY_LABEL: Record<ApprovalEntity, string> = { PO: "Purchase order", BOQ: "BOQ", AWARD: "Award recommendation" };

async function who(actor?: Actor): Promise<Actor> {
  const a = actor ?? (await getCurrentUser());
  if (!a) throw new Error("Sign in first.");
  return a;
}

type RequestRow = typeof approvalRequests.$inferSelect;
type StepRow = typeof approvalSteps.$inferSelect;

const toState = (s: StepRow): StepState => ({
  id: s.id, stepOrder: s.stepOrder, status: s.status, approverRole: (s.approverRole as Role | null) ?? null,
  approverUserId: s.approverUserId, memberName: s.memberName, decidedById: s.decidedById,
});

export async function activePolicies(): Promise<Policy[]> {
  const rows = await db.select().from(approvalPolicies).where(eq(approvalPolicies.active, true));
  return rows.map((p) => ({
    id: p.id, entity: p.entity, label: p.label, approverRole: p.approverRole as Role, minAmountEgp: num(p.minAmountEgp),
    maxAmountEgp: p.maxAmountEgp == null ? null : num(p.maxAmountEgp), stepOrder: p.stepOrder, facilityId: p.facilityId, active: p.active,
  }));
}

/** The pending request for a record, if any. */
export async function pendingRequest(entity: ApprovalEntity, entityId: number): Promise<RequestRow | null> {
  const [r] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.entity, entity), eq(approvalRequests.entityId, entityId), eq(approvalRequests.status, "PENDING"))).limit(1);
  return r ?? null;
}

/**
 * Open an approval request. Builds the steps from the active policies (and, for an award, the committee members),
 * opens the first order and notifies its approvers. When no policy applies the request is approved at once and the
 * owning module's approval effect runs (e.g. a PO goes straight to APPROVED), with a note saying so.
 */
export async function startApproval(input: {
  entity: ApprovalEntity; entityId: number; title: string; href: string; amountEgp?: number | null; facilityId?: number | null;
  committeeMembers?: CommitteeMemberInput[]; note?: string | null;
}, actor?: Actor): Promise<{ requestId: number; status: "PENDING" | "APPROVED"; steps: number }> {
  const me = await who(actor);
  if (await pendingRequest(input.entity, input.entityId)) throw new Error("This record is already waiting for approval.");
  const drafts = buildSteps({
    entity: input.entity, policies: await activePolicies(), amountEgp: input.amountEgp ?? null, facilityId: input.facilityId ?? null,
    committeeMembers: input.committeeMembers,
  });
  if (input.entity === "AWARD" && !drafts.some((d) => d.approverRole === "DIRECTOR")) {
    throw new Error("No competent-authority rule is active for awards (Law 182/2018, art. 35). Ask an administrator to switch one on under Approval rules & settings.");
  }
  // Every step needs someone who can actually decide it, or the request would wait forever with nobody notified.
  const memberIds = drafts.filter((d) => d.approverUserId != null).map((d) => d.approverUserId as number);
  for (const d of drafts) {
    if (!d.approverRole || d.approverUserId != null) continue;
    const eligible = (await usersWithRole(d.approverRole, input.facilityId ?? null))
      .filter((u) => u !== me.id && !(input.entity === "AWARD" && memberIds.includes(u)));
    if (!eligible.length) {
      throw new Error(`Nobody can decide the step “${d.label}”: it needs a ${ROLE_LABELS[d.approverRole]} who can see this facility` +
        `${input.entity === "AWARD" ? ", isn't on the committee" : ""} and didn't submit it. Ask an administrator to add one, or change the approval rules.`);
    }
  }
  const autoApproved = drafts.length === 0;
  const note = autoApproved ? [input.note, "No approval rule applies, so it was approved automatically."].filter(Boolean).join(" ") : input.note ?? null;

  const created = await db.transaction(async (tx) => {
    const [req] = await tx.insert(approvalRequests).values({
      entity: input.entity, entityId: input.entityId, title: input.title, href: input.href,
      amountEgp: input.amountEgp != null ? String(Math.round(input.amountEgp * 100) / 100) : null,
      facilityId: input.facilityId ?? null, requestedById: me.id, note,
      status: autoApproved ? "APPROVED" : "PENDING", decidedAt: autoApproved ? new Date() : null,
    }).returning({ id: approvalRequests.id });
    const stepRows = drafts.length
      ? await tx.insert(approvalSteps).values(drafts.map((d) => ({ ...d, requestId: req.id, status: "WAITING" as const }))).returning()
      : [];
    return { requestId: req.id, stepRows };
  }).catch((e: unknown) => {
    // The one-pending-request index: someone else submitted it a moment ago.
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new Error("This record is already waiting for approval.");
    throw e;
  });
  const { requestId, stepRows } = created;

  const logEntity = LOG_ENTITY[input.entity];
  const amount = input.amountEgp != null ? ` (${formatMoney(input.amountEgp, "EGP")})` : "";
  if (autoApproved) {
    await logActivity(logEntity, input.entityId, "approval_auto", `${ENTITY_LABEL[input.entity]} submitted${amount}: no approval rule applies, approved automatically`, me.name);
    await onRequestClosed(input.entity, input.entityId, "APPROVED", { requestId, actor: me });
    return { requestId, status: "APPROVED", steps: 0 };
  }
  await logActivity(logEntity, input.entityId, "approval_requested",
    `${ENTITY_LABEL[input.entity]} submitted for approval${amount}: ${describeChain(drafts)}`, me.name);
  await recompute(requestId, me);
  return { requestId, status: "PENDING", steps: stepRows.length };
}

function describeChain(steps: { stepOrder: number; label: string }[]): string {
  const orders = [...new Set(steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  return orders.map((o) => {
    const g = steps.filter((s) => s.stepOrder === o);
    return g.length > 3 ? `${g.length} committee members` : g.map((s) => s.label).join(" + ");
  }).join(" → ");
}

/** Re-run the core after a change: save step changes, close the request if it ended, notify. */
async function recompute(requestId: number, actor: Actor) {
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  if (!req || req.status !== "PENDING") return;
  const steps = await db.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId)).orderBy(asc(approvalSteps.stepOrder), asc(approvalSteps.id));
  const quorum = await getSetting("committeeQuorum");
  const res = advance(steps.map(toState), quorum === "majority" ? "majority" : "all");
  for (const [id, status] of res.changes) await db.update(approvalSteps).set({ status }).where(eq(approvalSteps.id, id));
  await clearSettledNotifications(requestId);

  if (res.status === "PENDING") {
    await notifyPending(req, steps.filter((s) => res.newlyPending.includes(s.id)));
    return;
  }
  // Ended: guard against two decisions closing it at once.
  const closed = await db.update(approvalRequests).set({ status: res.status, decidedAt: new Date() })
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, "PENDING"))).returning({ id: approvalRequests.id });
  if (!closed.length) return;
  await logActivity(LOG_ENTITY[req.entity], req.entityId, res.status === "APPROVED" ? "approval_approved" : "approval_rejected",
    `${ENTITY_LABEL[req.entity]} ${res.status === "APPROVED" ? "approved: every step signed" : "rejected"}`, actor.name);
  await onRequestClosed(req.entity, req.entityId, res.status, { requestId, actor });
  if (req.requestedById && req.requestedById !== actor.id) {
    await notifyUsers([req.requestedById], {
      kind: "approval_decided", title: `${res.status === "APPROVED" ? "Approved" : "Rejected"}: ${req.title}`,
      body: res.status === "APPROVED" ? "Every approval step has signed." : "An approver rejected it; see their comment.",
      href: req.href, dedupeKey: `approval_decided:${req.id}`,
    });
  }
}

/**
 * "Approval needed" notifications for steps that are no longer waiting (decided, skipped, request closed) are marked
 * read for everyone, so nobody is asked to sign something already settled.
 */
async function clearSettledNotifications(requestId: number) {
  const settled = await db.select({ id: approvalSteps.id }).from(approvalSteps)
    .where(and(eq(approvalSteps.requestId, requestId), sql`${approvalSteps.status} <> 'PENDING'`));
  if (!settled.length) return;
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(isNull(notifications.readAt), inArray(notifications.dedupeKey, settled.map((s) => `approval:${s.id}`))));
}

async function notifyPending(req: RequestRow, steps: StepRow[]) {
  if (!steps.length) return;
  const chairs = req.entity === "AWARD"
    ? [...await awardChairs(req.entityId), ...(await db.select({ u: approvalSteps.approverUserId }).from(approvalSteps)
        .where(and(eq(approvalSteps.requestId, req.id), sql`${approvalSteps.approverUserId} is not null`))).map((r) => r.u as number)]
    : [];
  for (const s of steps) {
    let ids: number[] = [];
    let title = `Approval needed: ${req.title}`;
    if (s.approverUserId) ids = [s.approverUserId];
    else if (s.approverRole) {
      ids = (await usersWithRole(s.approverRole as Role, req.facilityId)).filter((u) => u !== req.requestedById && !chairs.includes(u));
    } else if (s.memberName && req.requestedById) {
      ids = [req.requestedById]; // external member: whoever submitted records the paper signature
      title = `Record ${s.memberName}'s signature: ${req.title}`;
    }
    await notifyUsers(ids, { kind: "approval_needed", title, body: s.label, href: req.href, dedupeKey: `approval:${s.id}` });
  }
}

async function loadForDecision(stepId: number) {
  const [step] = await db.select().from(approvalSteps).where(eq(approvalSteps.id, stepId));
  if (!step) return null;
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, step.requestId));
  if (!req) return null;
  const steps = await db.select().from(approvalSteps).where(eq(approvalSteps.requestId, req.id));
  return { step, req, steps };
}

async function seesFacility(actor: Actor, facilityId: number | null): Promise<boolean> {
  if (facilityId == null) return true;
  const scope = await facilityScope(actor as CurrentUser);
  return scope == null || scope.includes(facilityId);
}

/** Whether `actor` may decide this step (for showing buttons). */
export async function verdictFor(step: StepRow, req: RequestRow, steps: StepRow[], actor: Actor, chairs?: number[]): Promise<Verdict> {
  if (!(await seesFacility(actor, req.facilityId))) return { ok: false, reason: "You can't see this facility." };
  return canDecide(toState(step), actor, {
    entity: req.entity, requestStatus: req.status, requestedById: req.requestedById,
    chairUserIds: chairs ?? (req.entity === "AWARD" ? await awardChairs(req.entityId) : []), steps: steps.map(toState),
  });
}

/** Approve or reject a step. A comment is required to reject. */
export async function decideStep(stepId: number, decision: "APPROVED" | "REJECTED", comment: string | null, actor?: Actor): Promise<Result> {
  const me = await who(actor);
  const text = comment?.trim() || null;
  if (decision === "REJECTED" && !text) return { ok: false, error: "Say why you are rejecting: the comment goes to the requester and into the record." };
  const loaded = await loadForDecision(stepId);
  if (!loaded) return { ok: false, error: "This approval step no longer exists." };
  const { step, req, steps } = loaded;
  const v = await verdictFor(step, req, steps, me);
  if (!v.ok) return { ok: false, error: v.reason };
  const done = await db.update(approvalSteps).set({ status: decision, decidedById: me.id, decidedAt: new Date(), comment: text?.slice(0, 2000) ?? null })
    .where(and(eq(approvalSteps.id, stepId), eq(approvalSteps.status, "PENDING"))).returning({ id: approvalSteps.id });
  if (!done.length) return { ok: false, error: "Someone decided this step a moment ago. Reload the page." };
  await logActivity(LOG_ENTITY[req.entity], req.entityId, decision === "APPROVED" ? "approval_step_approved" : "approval_step_rejected",
    `${step.label}: ${decision === "APPROVED" ? (isMemberStep(toState(step)) ? "signed" : "approved") : "rejected"} by ${me.name}${text ? ` — “${text}”` : ""}`, me.name);
  await recompute(req.id, me);
  return { ok: true, message: decision === "APPROVED" ? (isMemberStep(toState(step)) ? "Signed." : "Approved.") : "Rejected. The requester has been told." };
}

/** Record an external committee member's signature from the signed minutes (procurement users only). */
export async function recordPaperSignature(stepId: number, by?: Actor, reference?: string | null): Promise<Result> {
  const me = await who(by);
  const loaded = await loadForDecision(stepId);
  if (!loaded) return { ok: false, error: "This approval step no longer exists." };
  const { step, req } = loaded;
  if (!(await seesFacility(me, req.facilityId))) return { ok: false, error: "You can't see this facility." };
  const v = canRecordPaper(toState(step), me, req.status);
  if (!v.ok) return { ok: false, error: v.reason };
  const ref = reference?.trim() || null;
  const comment = `Signature on the signed minutes, recorded by ${me.name}${ref ? ` (${ref})` : ""}`;
  const done = await db.update(approvalSteps).set({ status: "APPROVED", decidedById: me.id, decidedAt: new Date(), comment })
    .where(and(eq(approvalSteps.id, stepId), eq(approvalSteps.status, "PENDING"))).returning({ id: approvalSteps.id });
  if (!done.length) return { ok: false, error: "This signature was recorded a moment ago. Reload the page." };
  await logActivity(LOG_ENTITY[req.entity], req.entityId, "approval_paper_signature", `${step.label}: paper signature recorded by ${me.name}${ref ? ` (${ref})` : ""}`, me.name);
  await recompute(req.id, me);
  return { ok: true, message: `${step.memberName}'s signature recorded.` };
}

/**
 * Withdraw a pending request. `revert` (default true) runs the module's "back to draft" effect; pass false when the
 * module is changing the record itself (e.g. cancelling the PO).
 */
export async function cancelApproval(entity: ApprovalEntity, entityId: number, reason: string, actor?: Actor, revert = true): Promise<boolean> {
  const me = await who(actor);
  const req = await pendingRequest(entity, entityId);
  if (!req) return false;
  const closed = await db.update(approvalRequests).set({ status: "CANCELLED", decidedAt: new Date(), note: [req.note, `Withdrawn: ${reason}`].filter(Boolean).join(" ") })
    .where(and(eq(approvalRequests.id, req.id), eq(approvalRequests.status, "PENDING"))).returning({ id: approvalRequests.id });
  if (!closed.length) return false;
  await db.update(approvalSteps).set({ status: "SKIPPED" })
    .where(and(eq(approvalSteps.requestId, req.id), inArray(approvalSteps.status, ["WAITING", "PENDING"])));
  await clearSettledNotifications(req.id);
  await logActivity(LOG_ENTITY[entity], entityId, "approval_cancelled", `${ENTITY_LABEL[entity]} withdrawn from approval: ${reason}`, me.name);
  if (revert) await onRequestClosed(entity, entityId, "CANCELLED", { requestId: req.id, actor: me });
  return true;
}

export type ApprovalView = {
  request: RequestRow & { requestedByName: string | null };
  steps: (StepRow & { approverName: string | null; decidedByName: string | null })[];
};

/** The latest request for a record with its steps and names (null when it was never submitted). */
export async function getApprovalFor(entity: ApprovalEntity, entityId: number): Promise<ApprovalView | null> {
  const [req] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.entity, entity), eq(approvalRequests.entityId, entityId)))
    .orderBy(desc(approvalRequests.id)).limit(1);
  if (!req) return null;
  return viewOf(req);
}

async function viewOf(req: RequestRow): Promise<ApprovalView> {
  const steps = await db.select().from(approvalSteps).where(eq(approvalSteps.requestId, req.id)).orderBy(asc(approvalSteps.stepOrder), asc(approvalSteps.id));
  const ids = [...new Set([req.requestedById, ...steps.flatMap((s) => [s.approverUserId, s.decidedById])].filter((x): x is number => x != null))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
  return {
    request: { ...req, requestedByName: req.requestedById ? names.get(req.requestedById) ?? null : null },
    steps: steps.map((s) => ({ ...s, approverName: s.approverUserId ? names.get(s.approverUserId) ?? null : null, decidedByName: s.decidedById ? names.get(s.decidedById) ?? null : null })),
  };
}

export type PendingItem = { request: RequestRow; step: StepRow; mode: "decide" | "paper" };

/** Steps this user can act on now (decide, or record a paper signature), limited to the facilities they can see. */
export async function pendingForUser(user: Actor): Promise<PendingItem[]> {
  const scope = await facilityScope(user as CurrentUser);
  if (scope && scope.length === 0) return [];
  const rows = await db.select({ step: approvalSteps, request: approvalRequests }).from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .where(and(eq(approvalSteps.status, "PENDING"), eq(approvalRequests.status, "PENDING"),
      scope ? sql`(${approvalRequests.facilityId} is null or ${inArray(approvalRequests.facilityId, scope)})` : undefined))
    .orderBy(asc(approvalRequests.requestedAt));
  const out: PendingItem[] = [];
  const allSteps = new Map<number, StepRow[]>();
  for (const r of rows) {
    if (!allSteps.has(r.request.id)) allSteps.set(r.request.id, await db.select().from(approvalSteps).where(eq(approvalSteps.requestId, r.request.id)));
    if (canRecordPaper(toState(r.step), user, r.request.status).ok) { out.push({ ...r, mode: "paper" }); continue; }
    const v = await verdictFor(r.step, r.request, allSteps.get(r.request.id)!, user);
    if (v.ok) out.push({ ...r, mode: "decide" });
  }
  return out;
}

/** Requests this user submitted (latest first). */
export async function requestedBy(user: Actor, limit = 30) {
  return db.select().from(approvalRequests).where(eq(approvalRequests.requestedById, user.id)).orderBy(desc(approvalRequests.requestedAt)).limit(limit);
}

/** Decisions taken recently on requests the user can see. */
export async function recentDecisions(user: Actor, limit = 30) {
  const scope = await facilityScope(user as CurrentUser);
  if (scope && scope.length === 0) return [];
  return db.select({ step: approvalSteps, request: approvalRequests, decidedByName: users.name }).from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .leftJoin(users, eq(users.id, approvalSteps.decidedById))
    .where(and(inArray(approvalSteps.status, ["APPROVED", "REJECTED"]),
      scope ? sql`(${approvalRequests.facilityId} is null or ${inArray(approvalRequests.facilityId, scope)})` : undefined))
    .orderBy(desc(approvalSteps.decidedAt)).limit(limit);
}

export const roleLabel = (r: string | null) => (r ? ROLE_LABELS[r as Role] ?? r : null);
