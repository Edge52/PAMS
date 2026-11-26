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
