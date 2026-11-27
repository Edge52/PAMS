/**
 * Equipment request rules (wave 39). Pure. Department heads ask for and approve equipment only for the departments
 * they look after (Administration › Users › departments); biomedical engineering, planners and administrators may
 * ask for any department. The director's decision (boq.approve) comes after.
 */
import { can } from "../auth/permissions";

/** May this person send a request for this department (null = hospital-wide)? */
export function mayRequestFor(role: string, mine: ReadonlySet<number>, departmentId: number | null): boolean {
  if (!can(role, "requests.create")) return false;
  if (role !== "DEPARTMENT_HEAD") return true;
  return departmentId != null && mine.has(departmentId);
}

/** May this person give the department's approval to a request? Department heads: their departments only. */
export function mayApproveForDepartment(role: string, mine: ReadonlySet<number>, departmentId: number | null): boolean {
  if (!can(role, "requests.approve")) return false;
  if (role !== "DEPARTMENT_HEAD") return true;
  return departmentId != null && mine.has(departmentId);
}

/** A department head's own request counts as approved by the department when it is sent. */
export function approvedOnSend(role: string, mine: ReadonlySet<number>, departmentId: number | null): boolean {
  return role === "DEPARTMENT_HEAD" && departmentId != null && mine.has(departmentId);
}

/** The department step, in words, for the requests list. */
export function departmentStep(r: { departmentId: number | null; deptApprovedByName: string | null; status: string }): string | null {
  if (r.departmentId == null) return null;
  if (r.deptApprovedByName) return `Department approval: ${r.deptApprovedByName}`;
  return r.status === "SUBMITTED" ? "Waiting for the department head" : null;
}

/* ── Wave 42: the department first ── */

/** Start of the decision note when the director decided before the department head approved. */
export const OVERRIDE_PREFIX = "Decided before the department head approved — reason: ";
export const MIN_OVERRIDE_REASON = 10;

/** Does this request still wait for its department head? Only when the department has one and they haven't approved. */
export function waitsForDepartment(r: { departmentId: number | null; deptApprovedAt: Date | string | null }, deptHasHead: boolean): boolean {
  return r.departmentId != null && !r.deptApprovedAt && deptHasHead;
}

/**
 * Why the director may not decide now, or null. Before the department head approves, the director decides only with
 * a reason for not waiting.
 */
export function decisionProblem(r: { departmentId: number | null; deptApprovedAt: Date | string | null }, deptHasHead: boolean, overrideReason: string): string | null {
  if (!waitsForDepartment(r, deptHasHead)) return null;
  return overrideReason.trim().length >= MIN_OVERRIDE_REASON ? null
    : "The department head hasn't approved this request yet. Wait for them, or give the reason for deciding now (a sentence).";
}

/** The decision note as stored and shown: the override reason first when there was one. */
export function decisionNoteFor(note: string, overrideReason: string | null): string | null {
  const parts = [overrideReason ? `${OVERRIDE_PREFIX}${overrideReason.trim()}` : "", note.trim()].filter(Boolean);
  return parts.length ? parts.join(". ").slice(0, 2000) : null;
}
