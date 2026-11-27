import { describe, expect, it } from "vitest";
import { approvedOnSend, departmentStep, mayApproveForDepartment, mayRequestFor } from "./request-rules";

const mine = new Set([3, 4]);

describe("equipment request rules (wave 39)", () => {
  it("department heads ask only for their own departments", () => {
    expect(mayRequestFor("DEPARTMENT_HEAD", mine, 3)).toBe(true);
    expect(mayRequestFor("DEPARTMENT_HEAD", mine, 9)).toBe(false);
    expect(mayRequestFor("DEPARTMENT_HEAD", mine, null)).toBe(false);
    expect(mayRequestFor("DEPARTMENT_HEAD", new Set(), 3)).toBe(false);
  });
  it("biomedical, planners and admins ask for any department; viewers and technicians don't", () => {
    for (const r of ["BIOMEDICAL", "PLANNER", "ADMIN"]) expect(mayRequestFor(r, new Set(), 9)).toBe(true);
    for (const r of ["VIEWER", "TECHNICIAN", "FINANCE", "DIRECTOR"]) expect(mayRequestFor(r, mine, 3)).toBe(false);
  });
  it("department approval only for the head's departments (and admins)", () => {
    expect(mayApproveForDepartment("DEPARTMENT_HEAD", mine, 4)).toBe(true);
    expect(mayApproveForDepartment("DEPARTMENT_HEAD", mine, 5)).toBe(false);
    expect(mayApproveForDepartment("ADMIN", new Set(), 5)).toBe(true);
    expect(mayApproveForDepartment("BIOMEDICAL", mine, 3)).toBe(false);
    expect(mayApproveForDepartment("VIEWER", mine, 3)).toBe(false);
  });
  it("a head's own request is approved by the department on sending", () => {
    expect(approvedOnSend("DEPARTMENT_HEAD", mine, 3)).toBe(true);
    expect(approvedOnSend("BIOMEDICAL", mine, 3)).toBe(false);
  });
  it("words the department step", () => {
    expect(departmentStep({ departmentId: null, deptApprovedByName: null, status: "SUBMITTED" })).toBeNull();
    expect(departmentStep({ departmentId: 3, deptApprovedByName: null, status: "SUBMITTED" })).toBe("Waiting for the department head");
    expect(departmentStep({ departmentId: 3, deptApprovedByName: "Dr Sara", status: "APPROVED" })).toBe("Department approval: Dr Sara");
  });
});

describe("the department first (wave 42)", async () => {
  const { decisionNoteFor, decisionProblem, waitsForDepartment } = await import("./request-rules");
  const waiting = { departmentId: 3, deptApprovedAt: null };
  it("waits for the department head only when the department has one", () => {
    expect(waitsForDepartment(waiting, true)).toBe(true);
    expect(waitsForDepartment(waiting, false)).toBe(false);
    expect(waitsForDepartment({ departmentId: null, deptApprovedAt: null }, true)).toBe(false);
    expect(waitsForDepartment({ departmentId: 3, deptApprovedAt: new Date() }, true)).toBe(false);
  });
  it("lets the director decide early only with a reason", () => {
    expect(decisionProblem(waiting, true, "")).toMatch(/hasn't approved/);
    expect(decisionProblem(waiting, true, "short")).toMatch(/hasn't approved/);
    expect(decisionProblem(waiting, true, "Head on leave until March; ICU needs it now.")).toBeNull();
    expect(decisionProblem(waiting, false, "")).toBeNull();
  });
  it("keeps the reason in the decision note", () => {
    expect(decisionNoteFor("For next year", "Head on leave")).toBe("Decided before the department head approved — reason: Head on leave. For next year");
    expect(decisionNoteFor("", null)).toBeNull();
  });
});
