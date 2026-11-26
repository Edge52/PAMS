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
