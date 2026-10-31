/**
 * Approval engine — pure core. No database, no Next.js: everything here is unit-tested (core.test.ts).
 *
 *  - buildSteps():   policies (+ committee members for an award) + amount → the ordered steps of a new request.
 *  - advance():      after any decision, works out which steps are now pending, skipped, and the request status.
 *  - canDecide():    whether a user may approve/reject a step (role or named user, plus segregation of duties).
 *
 * Steps sharing a stepOrder run together. "Policy" steps are for a role (anyone holding it); "member" steps are for
 * one committee member (a user account, or an external member whose paper signature a procurement user records).
 */
import type { Role } from "@/lib/auth/permissions";

export type ApprovalEntity = "PO" | "BOQ" | "AWARD" | "DISPOSAL";
export type StepStatus = "WAITING" | "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type Quorum = "all" | "majority";

export type Policy = {
  id: number; entity: ApprovalEntity; label: string; approverRole: Role;
  minAmountEgp: number; maxAmountEgp: number | null; stepOrder: number; facilityId: number | null; active: boolean;
};

export type CommitteeMemberInput = { userId: number | null; name: string; label: string };

export type StepDraft = {
  stepOrder: number; label: string; approverRole: Role | null; approverUserId: number | null; memberName: string | null;
};

export type StepState = {
  id: number; stepOrder: number; status: StepStatus; approverRole: Role | null; approverUserId: number | null;
  memberName: string | null; decidedById: number | null;
};

/** A policy applies when it is active, for this entity, for this facility (or all), and the amount is in [min, max). */
export function policyApplies(p: Policy, entity: ApprovalEntity, amountEgp: number | null, facilityId: number | null): boolean {
  if (!p.active || p.entity !== entity) return false;
  if (p.facilityId != null && p.facilityId !== facilityId) return false;
  if (entity !== "PO") return true; // BOQ, award and disposal policies have no amounts
  const amount = amountEgp ?? 0;
  if (amount < p.minAmountEgp) return false;
  if (p.maxAmountEgp != null && amount >= p.maxAmountEgp) return false;
  return true;
}

/**
 * Steps for a new request. Matching policies keep their relative order (orders are renumbered 1, 2, 3 … so gaps don't
 * matter). For an award, every committee member signs first (order 1) and the policy steps (the competent authority)
 * follow.
 */
export function buildSteps(input: {
  entity: ApprovalEntity; policies: Policy[]; amountEgp?: number | null; facilityId?: number | null;
  committeeMembers?: CommitteeMemberInput[];
}): StepDraft[] {
  const matching = input.policies
    .filter((p) => policyApplies(p, input.entity, input.amountEgp ?? null, input.facilityId ?? null))
    .sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id);
  const orders = [...new Set(matching.map((p) => p.stepOrder))];
  const members = input.entity === "AWARD" ? input.committeeMembers ?? [] : [];
  const offset = members.length ? 1 : 0;
  const out: StepDraft[] = members.map((m) => ({
    stepOrder: 1, label: m.label, approverRole: null, approverUserId: m.userId, memberName: m.userId ? null : m.name,
  }));
  for (const p of matching) {
    out.push({ stepOrder: orders.indexOf(p.stepOrder) + 1 + offset, label: p.label, approverRole: p.approverRole, approverUserId: null, memberName: null });
  }
  return out;
}

/** Member steps (committee signatures) have no role. */
export const isMemberStep = (s: Pick<StepState, "approverRole">) => s.approverRole == null;

/** Votes needed in a committee order of `n` voting members. */
export function votesNeeded(n: number, quorum: Quorum): number {
  return quorum === "all" ? n : Math.floor(n / 2) + 1;
}

export type AdvanceResult = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** New status per step id (only steps whose status changes). */
  changes: Map<number, StepStatus>;
  /** Steps that just became PENDING (notify their approvers). */
  newlyPending: number[];
};

/**
 * Recompute a request after a decision.
 * - Orders run lowest first; the next order becomes PENDING only when the current one is complete.
 * - A policy order is complete when all its steps are approved; any rejection rejects the request.
 * - A committee order (all member steps) is complete when the quorum is reached ("all" members, or a majority); the
 *   members who haven't signed then are skipped. With "all", one rejection rejects; with "majority", the request is
 *   rejected once a majority can no longer be reached (dissents are recorded on their steps).
 * - When the request ends (approved or rejected), every step still waiting or pending is skipped.
 */
export function advance(steps: StepState[], quorum: Quorum): AdvanceResult {
  const cur = new Map(steps.map((s) => [s.id, s.status]));
  const changes = new Map<number, StepStatus>();
  const set = (id: number, st: StepStatus) => { if (cur.get(id) !== st) { cur.set(id, st); changes.set(id, st); } };
  const orders = [...new Set(steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  const newlyPending: number[] = [];
  let status: AdvanceResult["status"] = "APPROVED";

  for (const o of orders) {
    const group = steps.filter((s) => s.stepOrder === o);
    const committee = group.every(isMemberStep);
    const approved = group.filter((s) => cur.get(s.id) === "APPROVED").length;
    const rejected = group.filter((s) => cur.get(s.id) === "REJECTED").length;
    const needed = committee ? votesNeeded(group.length, quorum) : group.length;

    if (!committee ? rejected > 0 : rejected > group.length - needed) { status = "REJECTED"; break; }
    if (approved >= needed) {
      for (const s of group) if (cur.get(s.id) === "WAITING" || cur.get(s.id) === "PENDING") set(s.id, "SKIPPED");
      continue;
    }
    // This order is the current one.
    for (const s of group) {
      if (cur.get(s.id) === "WAITING") { set(s.id, "PENDING"); newlyPending.push(s.id); }
    }
    status = "PENDING";
    break;
  }

  if (status !== "PENDING") {
    for (const s of steps) if (cur.get(s.id) === "WAITING" || cur.get(s.id) === "PENDING") set(s.id, "SKIPPED");
  }
  return { status, changes, newlyPending };
}

export type Decider = { id: number; role: Role | string };
export type DecideContext = {
  entity: ApprovalEntity;
  requestStatus: RequestStatus;
  requestedById: number | null;
  /** Users who chair the committee whose work this request approves (award). */
  chairUserIds?: number[];
  /** Every step of the request (for "already decided another step"). */
  steps?: Pick<StepState, "id" | "approverRole" | "approverUserId" | "decidedById" | "status">[];
};

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Whether `user` may approve or reject `step` in the app. External members are recorded with canRecordPaper instead. */
export function canDecide(step: StepState, user: Decider, ctx: DecideContext): Verdict {
  if (ctx.requestStatus !== "PENDING") return { ok: false, reason: "This request is already closed." };
  if (step.status !== "PENDING") return { ok: false, reason: step.status === "WAITING" ? "This step isn't open yet: earlier steps must be approved first." : "This step has already been decided." };
  if (isMemberStep(step)) {
    if (step.approverUserId == null) return { ok: false, reason: "This member has no account: a procurement officer records their signature from the signed minutes." };
    if (step.approverUserId !== user.id) return { ok: false, reason: "Only the named committee member can sign this step." };
    return { ok: true }; // committee members sign their own committee's recommendation, even the one who recorded it
  }
  if (step.approverUserId != null && step.approverUserId !== user.id) return { ok: false, reason: "This step is for a named person." };
  if (step.approverRole && user.role !== step.approverRole) return { ok: false, reason: "Your role doesn't decide this step." };
  if (ctx.requestedById != null && ctx.requestedById === user.id) {
    return { ok: false, reason: "You submitted this request, so someone else holding the role must decide it." };
  }
  if (ctx.entity === "AWARD" && ctx.chairUserIds?.includes(user.id)) {
    return { ok: false, reason: "You chair the committee that made this recommendation, so you can't also approve it (Law 182/2018, art. 28)." };
  }
  // Art. 28 bars the chair from approving the committee's work; we apply the same separation to every member, so
  // nobody signs the recommendation and then approves it as competent authority.
  if (ctx.entity === "AWARD" && ctx.steps?.some((s) => isMemberStep(s) && s.approverUserId === user.id)) {
    return { ok: false, reason: "You sit on the committee that made this recommendation, so the award must be approved by someone outside it." };
  }
  if (ctx.steps?.some((s) => s.id !== step.id && !isMemberStep(s) && s.decidedById === user.id && s.status === "APPROVED")) {
    return { ok: false, reason: "You already approved another step of this request; a different person must decide this one." };
  }
  return { ok: true };
}

/** Recording an external member's paper signature: a pending member step without an account, by a procurement user. */
export function canRecordPaper(step: StepState, user: Decider, requestStatus: RequestStatus): Verdict {
  if (requestStatus !== "PENDING") return { ok: false, reason: "This request is already closed." };
  if (step.status !== "PENDING") return { ok: false, reason: "This signature isn't open." };
  if (!isMemberStep(step) || step.approverUserId != null || !step.memberName) return { ok: false, reason: "Only external members without an account sign on paper." };
  if (user.role !== "PROCUREMENT") return { ok: false, reason: "Only a procurement officer records paper signatures." };
  return { ok: true };
}

/** Short, human description of who decides a step. */
export function whoDecides(s: Pick<StepState, "approverRole" | "approverUserId" | "memberName">, names: { users: Map<number, string>; roles: Record<string, string> }): string {
  if (s.approverUserId != null) return names.users.get(s.approverUserId) ?? "Named user";
  if (s.memberName) return `${s.memberName} (signs on paper)`;
  if (s.approverRole) return `Any ${names.roles[s.approverRole]?.toLowerCase() ?? s.approverRole.toLowerCase()}`;
  return "—";
}
