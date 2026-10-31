import { describe, expect, it } from "vitest";
import {
  actionProblem, allowedActions, assetStatusAfter, downtimeHours, formatHours, isLate, nextStatus, responseDue, suggestedPriority,
  workOrderKpis, type KpiRow,
} from "./work-orders";

const lead = { id: 1, canAssign: true, canWork: true };
const tech = { id: 2, canAssign: false, canWork: true };
const nurse = { id: 3, canAssign: false, canWork: false };
const t = (iso: string) => new Date(iso);

describe("work order flow", () => {
  it("follows the status machine", () => {
    expect(nextStatus("OPEN", "assign")).toBe("ASSIGNED");
    expect(nextStatus("ASSIGNED", "start")).toBe("IN_PROGRESS");
    expect(nextStatus("IN_PROGRESS", "hold")).toBe("ON_HOLD");
    expect(nextStatus("ON_HOLD", "resume")).toBe("IN_PROGRESS");
    expect(nextStatus("IN_PROGRESS", "complete")).toBe("COMPLETED");
    expect(nextStatus("COMPLETED", "close")).toBe("CLOSED");
    expect(nextStatus("COMPLETED", "reopen")).toBe("IN_PROGRESS");
    expect(nextStatus("OPEN", "complete")).toBeNull();
    expect(nextStatus("CLOSED", "reopen")).toBeNull();
    expect(nextStatus("CANCELLED", "assign")).toBeNull();
  });
  it("reassigning keeps the status", () => {
    expect(nextStatus("IN_PROGRESS", "assign")).toBe("IN_PROGRESS");
    expect(nextStatus("ON_HOLD", "assign")).toBe("ON_HOLD");
  });
  it("only assigners assign, close and reopen", () => {
    const wo = { status: "OPEN", assignedToId: null, reportedById: 3 };
    expect(actionProblem(wo, "assign", lead)).toBeNull();
    expect(actionProblem(wo, "assign", tech)).toMatch(/biomedical lead/);
    expect(actionProblem({ ...wo, status: "COMPLETED", assignedToId: 2 }, "close", tech)).toMatch(/biomedical lead/);
  });
  it("the assignee works the job; other technicians can't", () => {
    const wo = { status: "ASSIGNED", assignedToId: 2, reportedById: 3 };
    expect(actionProblem(wo, "start", tech)).toBeNull();
    expect(actionProblem(wo, "start", { ...tech, id: 9 })).toMatch(/someone else/);
    expect(actionProblem(wo, "start", lead)).toBeNull();
    expect(actionProblem(wo, "start", nurse)).toMatch(/maintenance rights/);
  });
  it("a reporter may withdraw an untouched report only", () => {
    expect(actionProblem({ status: "OPEN", assignedToId: null, reportedById: 3 }, "cancel", nurse)).toBeNull();
    expect(actionProblem({ status: "ASSIGNED", assignedToId: 2, reportedById: 3 }, "cancel", nurse)).not.toBeNull();
    expect(actionProblem({ status: "OPEN", assignedToId: null, reportedById: 4 }, "cancel", nurse)).not.toBeNull();
  });
  it("lists what the actor can do", () => {
    expect(allowedActions({ status: "IN_PROGRESS", assignedToId: 2, reportedById: 3 }, tech)).toEqual(["hold", "complete"]);
    expect(allowedActions({ status: "CLOSED", assignedToId: 2, reportedById: 3 }, lead)).toEqual([]);
  });
});

describe("response targets", () => {
  it("suggests priority from criticality and downtime", () => {
    expect(suggestedPriority("LIFE_SUPPORT", true)).toBe("URGENT");
    expect(suggestedPriority("LIFE_SUPPORT", false)).toBe("HIGH");
    expect(suggestedPriority("HIGH", true)).toBe("HIGH");
    expect(suggestedPriority("LOW", false)).toBe("LOW");
    expect(suggestedPriority(null, true)).toBe("NORMAL");
  });
  it("computes the due time and lateness", () => {
    const due = responseDue(t("2026-10-01T08:00:00Z"), "URGENT");
    expect(due.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const wo = { status: "OPEN", dueAt: due, startedAt: null };
    expect(isLate(wo, t("2026-10-01T11:00:00Z"))).toBe(false);
    expect(isLate(wo, t("2026-10-01T13:00:00Z"))).toBe(true);
    expect(isLate({ status: "COMPLETED", dueAt: due, startedAt: t("2026-10-01T10:00:00Z") }, t("2026-10-05T00:00:00Z"))).toBe(false);
    expect(isLate({ status: "COMPLETED", dueAt: due, startedAt: t("2026-10-01T14:00:00Z") }, t("2026-10-05T00:00:00Z"))).toBe(true);
    expect(isLate({ status: "CANCELLED", dueAt: due, startedAt: null }, t("2026-10-05T00:00:00Z"))).toBe(false);
  });
});

describe("downtime and KPIs", () => {
  it("counts downtime only when the device was down", () => {
    expect(downtimeHours({ downtimeStart: null, downtimeEnd: null }, t("2026-10-02T00:00:00Z"))).toBe(0);
    expect(downtimeHours({ downtimeStart: t("2026-10-01T00:00:00Z"), downtimeEnd: t("2026-10-01T06:00:00Z") }, t("2026-10-09T00:00:00Z"))).toBe(6);
    expect(downtimeHours({ downtimeStart: t("2026-10-01T00:00:00Z"), downtimeEnd: null }, t("2026-10-02T00:00:00Z"))).toBe(24);
  });
  it("formats durations", () => {
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(5.25)).toBe("5.3 h");
    expect(formatHours(72)).toBe("3 d");
    expect(formatHours(null)).toBe("—");
  });
  it("computes MTTR, MTBF, response and on-time share", () => {
    const base: Omit<KpiRow, "assetId" | "reportedAt"> = {
      type: "CORRECTIVE", status: "CLOSED", priority: "NORMAL", deviceDown: false, dueAt: null, startedAt: null, completedAt: null, downtimeStart: null, downtimeEnd: null,
    };
    const rows: KpiRow[] = [
      { ...base, assetId: 1, reportedAt: t("2026-09-01T00:00:00Z"), dueAt: t("2026-09-01T04:00:00Z"), startedAt: t("2026-09-01T02:00:00Z"), completedAt: t("2026-09-01T10:00:00Z"),
        deviceDown: true, downtimeStart: t("2026-09-01T00:00:00Z"), downtimeEnd: t("2026-09-01T10:00:00Z") },
      { ...base, assetId: 1, reportedAt: t("2026-09-11T00:00:00Z"), dueAt: t("2026-09-11T04:00:00Z"), startedAt: t("2026-09-11T06:00:00Z"), completedAt: t("2026-09-11T20:00:00Z") },
      { ...base, assetId: 2, status: "OPEN", priority: "URGENT", reportedAt: t("2026-10-01T00:00:00Z"), dueAt: t("2026-10-01T04:00:00Z") },
      { ...base, assetId: 3, status: "CANCELLED", reportedAt: t("2026-10-01T00:00:00Z") },
    ];
    const k = workOrderKpis(rows, t("2026-10-01T08:00:00Z"));
    expect(k.open).toBe(1);
    expect(k.urgentOpen).toBe(1);
    expect(k.late).toBe(1);
    expect(k.completed).toBe(2);
    expect(k.meanResponseHours).toBe(4);   // (2 + 6) / 2
    expect(k.mttrHours).toBe(15);          // (10 + 20) / 2
    expect(k.mtbfDays).toBe(10);
    expect(k.downtimeHours).toBe(10);
    expect(k.onTimePct).toBe(50);
  });
  it("returns nulls with no data", () => {
    const k = workOrderKpis([], new Date());
    expect(k).toMatchObject({ open: 0, mttrHours: null, mtbfDays: null, onTimePct: null, downtimeHours: 0 });
  });
});

describe("asset status effects", () => {
  it("takes a down device out of service and brings it back", () => {
    expect(assetStatusAfter("report", { assetStatus: "IN_SERVICE", deviceDown: true, otherDownJobs: 0 })).toBe("OUT_OF_SERVICE");
    expect(assetStatusAfter("report", { assetStatus: "IN_SERVICE", deviceDown: false, otherDownJobs: 0 })).toBeNull();
    expect(assetStatusAfter("start", { assetStatus: "OUT_OF_SERVICE", deviceDown: true, otherDownJobs: 0 })).toBe("UNDER_MAINTENANCE");
    expect(assetStatusAfter("complete", { assetStatus: "UNDER_MAINTENANCE", deviceDown: true, returnToService: true, otherDownJobs: 0 })).toBe("IN_SERVICE");
    expect(assetStatusAfter("complete", { assetStatus: "UNDER_MAINTENANCE", deviceDown: true, returnToService: false, otherDownJobs: 0 })).toBeNull();
  });
  it("keeps it down while another job holds it", () => {
    expect(assetStatusAfter("complete", { assetStatus: "UNDER_MAINTENANCE", deviceDown: true, returnToService: true, otherDownJobs: 1 })).toBeNull();
    expect(assetStatusAfter("cancel", { assetStatus: "OUT_OF_SERVICE", deviceDown: true, otherDownJobs: 1 })).toBeNull();
  });
  it("cancelling a false alarm puts it back; disposed and stock assets are left alone", () => {
    expect(assetStatusAfter("cancel", { assetStatus: "OUT_OF_SERVICE", deviceDown: true, otherDownJobs: 0 })).toBe("IN_SERVICE");
    expect(assetStatusAfter("report", { assetStatus: "DISPOSED", deviceDown: true, otherDownJobs: 0 })).toBeNull();
    expect(assetStatusAfter("report", { assetStatus: "IN_STOCK", deviceDown: true, otherDownJobs: 0 })).toBeNull();
  });
});
