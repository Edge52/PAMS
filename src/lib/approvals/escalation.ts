/**
 * Wave 41: approval deputies (out of office) and escalation. Pure — tested in escalation.test.ts.
 *
 *  - Working days: lib/working-days.ts (Friday and Saturday off, and the hospital's public holidays).
 *  - A step waiting `days` working days (per entity, default 3) reminds its approvers (level 1); at twice that it is
 *    escalated to the director, or to the administrators when the step is the director's (level 2).
 *  - Delegation: from startsOn to endsOn (both included) approvals for a person go to their deputy. When the deputy
 *    is out too, it follows on (at most 5 hops, never round in a circle). Committee signatures are personal
 *    (Law 182/2018) and are never delegated.
 */
import type { Role } from "@/lib/auth/permissions";
import { canDecide, isMemberStep, type DecideContext, type StepState, type Verdict } from "./core";

export const DEFAULT_ESCALATION_DAYS = 3;
export const ESCALATION_ENTITIES = ["PO", "BOQ", "AWARD", "DISPOSAL", "EQUIPMENT_PLAN"] as const;

/** Days for an entity from the setting (missing or bad = the default; 1–60). */
export function escalationDays(entity: string, setting: Record<string, unknown> | null | undefined): number {
  const v = Number(setting?.[entity]);
  return Number.isFinite(v) && v >= 1 ? Math.min(Math.round(v), 60) : DEFAULT_ESCALATION_DAYS;
}

/** The level a step waiting `waited` working days should have reached. */
export function escalationLevelDue(waited: number, days: number): 0 | 1 | 2 {
  if (waited >= days * 2) return 2;
  if (waited >= days) return 1;
  return 0;
}

/** Who a level-2 escalation goes to: the director, or the administrators when the step is already the director's. */
export const escalationRole = (approverRole: Role | string | null): Role => (approverRole === "DIRECTOR" ? "ADMIN" : "DIRECTOR");

export type Delegation = { id?: number; userId: number; deputyId: number; startsOn: string; endsOn: string; cancelled?: boolean };

export const delegationActive = (d: Delegation, today: string) => !d.cancelled && d.startsOn <= today && today <= d.endsOn;

/** The person who acts for `userId` today (following deputies who are out too), or null when they're in. */
export function deputyOf(userId: number, list: readonly Delegation[], today: string): number | null {
  const active = list.filter((d) => delegationActive(d, today));
  const seen = new Set([userId]);
  let cur = userId, out: number | null = null;
  for (let i = 0; i < 5; i++) {
    const d = active.find((x) => x.userId === cur);
    if (!d || seen.has(d.deputyId)) break;
    seen.add(d.deputyId);
    out = cur = d.deputyId;
  }
  return out;
}

/** People `deputyId` acts for today. */
export function principalsOf(deputyId: number, list: readonly Delegation[], today: string): number[] {
  const ids = [...new Set(list.filter((d) => delegationActive(d, today)).map((d) => d.userId))];
  return ids.filter((u) => deputyOf(u, list, today) === deputyId);
}

/** Replace people who are out with their deputies (keeping order, no repeats). */
export function withDeputies(ids: readonly number[], list: readonly Delegation[], today: string): number[] {
  return [...new Set(ids.map((u) => deputyOf(u, list, today) ?? u))];
}

/** Why a new delegation can't be saved, or null. */
export function delegationProblem(d: Delegation, existing: readonly Delegation[], today: string): string | null {
  if (d.deputyId === d.userId) return "Choose someone else as the deputy.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(d.endsOn)) return "Enter both dates.";
  if (d.endsOn < d.startsOn) return "The last day is before the first day.";
  if (d.endsOn < today) return "The dates are in the past.";
  const overlaps = (x: Delegation) => !x.cancelled && x.startsOn <= d.endsOn && d.startsOn <= x.endsOn;
  if (existing.some((x) => x.userId === d.userId && x.id !== d.id && overlaps(x))) return "There is already a deputy for some of these days. End that one first.";
  if (existing.some((x) => x.userId === d.deputyId && x.deputyId === d.userId && overlaps(x))) return "The deputy has named this person as their own deputy for these days.";
  return null;
}

/**
 * Whether `deputy` may decide `step` for `principal` (who is out and named them): the principal must be able to
 * decide it, and the deputy must pass the same separation of duties (didn't submit it, didn't approve another step,
 * isn't on the award committee).
 */
export function canDecideFor(step: StepState, deputy: { id: number }, principal: { id: number; role: Role | string }, ctx: DecideContext): Verdict {
  if (isMemberStep(step)) return { ok: false, reason: "Committee signatures can't be given by a deputy." };
  const asPrincipal = canDecide(step, principal, ctx);
  if (!asPrincipal.ok) return asPrincipal;
  const named = step.approverUserId === principal.id ? { ...step, approverUserId: deputy.id } : step;
  return canDecide(named, { id: deputy.id, role: principal.role }, ctx);
}
