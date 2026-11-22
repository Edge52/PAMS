import { describe, expect, it } from "vitest";
import {
  byDepartment, calibrationCompliance, calibrationHoldProblem, calibrationInterval, calibrationState, nextCalibrationDue, statusAfterCalibration,
} from "./calibration";

const today = "2026-11-22";

describe("calibration interval and due date", () => {
  it("takes the device's own interval, then the type's, then 12 months", () => {
    expect(calibrationInterval(6, 24)).toEqual({ months: 6, source: "device" });
    expect(calibrationInterval(null, 24)).toEqual({ months: 24, source: "type" });
    expect(calibrationInterval(undefined, null)).toEqual({ months: 12, source: "default" });
    expect(calibrationInterval(0, 0).source).toBe("default");
  });
  it("adds the interval, clamped to the month end, and gives no date after a failure", () => {
    expect(nextCalibrationDue("2026-01-31", 1, "PASS")).toBe("2026-02-28");
    expect(nextCalibrationDue("2026-03-10", 12, "ADJUSTED")).toBe("2027-03-10");
    expect(nextCalibrationDue("2026-03-10", 12, "FAIL")).toBeNull();
  });
});

describe("calibration state", () => {
  it("reads the latest record", () => {
    expect(calibrationState(null, today)).toBe("never");
    expect(calibrationState({ result: "FAIL", nextDue: null }, today)).toBe("failed");
    expect(calibrationState({ result: "PASS", nextDue: "2026-11-21" }, today)).toBe("overdue");
    expect(calibrationState({ result: "PASS", nextDue: today }, today)).toBe("soon");
    expect(calibrationState({ result: "PASS", nextDue: "2026-12-22" }, today)).toBe("soon");
    expect(calibrationState({ result: "ADJUSTED", nextDue: "2026-12-23" }, today)).toBe("ok");
  });
});

describe("compliance", () => {
  it("counts in-date devices (due soon included) against all that need calibration", () => {
    expect(calibrationCompliance([])).toEqual({ counted: 0, inDate: 0, pct: null });
    expect(calibrationCompliance(["ok", "soon", "overdue", "never", "failed", "ok"])).toEqual({ counted: 6, inDate: 3, pct: 50 });
    expect(calibrationCompliance(["ok", "ok", "overdue"]).pct).toBe(66.7);
  });
  it("groups by department, worst first", () => {
    const d = byDepartment([
      { departmentId: 1, departmentName: "ICU", state: "ok" }, { departmentId: 1, departmentName: "ICU", state: "overdue" },
      { departmentId: 2, departmentName: "Theatres", state: "ok" }, { departmentId: null, departmentName: null, state: "never" },
    ]);
    expect(d.map((x) => [x.name, x.pct])).toEqual([["No department", 0], ["ICU", 50], ["Theatres", 100]]);
    expect(d[1]).toMatchObject({ total: 2, ok: 1, overdue: 1 });
  });
});

describe("status after a calibration", () => {
  const base = { previousFailed: false, otherDownJobs: 0 };
  it("a failure takes a device in use out of service", () => {
    expect(statusAfterCalibration("FAIL", { ...base, assetStatus: "IN_SERVICE" })).toBe("OUT_OF_SERVICE");
    expect(statusAfterCalibration("FAIL", { ...base, assetStatus: "INSTALLED" })).toBe("OUT_OF_SERVICE");
    expect(statusAfterCalibration("FAIL", { ...base, assetStatus: "OUT_OF_SERVICE" })).toBeNull();
    for (const s of ["IN_STOCK", "ON_LOAN", "DISPOSED"]) expect(statusAfterCalibration("FAIL", { ...base, assetStatus: s })).toBeNull();
  });
  it("a pass after a failure puts it back to its earlier status", () => {
    expect(statusAfterCalibration("PASS", { assetStatus: "OUT_OF_SERVICE", previousFailed: true, statusBefore: "IN_SERVICE" })).toBe("IN_SERVICE");
    expect(statusAfterCalibration("ADJUSTED", { assetStatus: "OUT_OF_SERVICE", previousFailed: true, statusBefore: "INSTALLED" })).toBe("INSTALLED");
    expect(statusAfterCalibration("PASS", { assetStatus: "OUT_OF_SERVICE", previousFailed: true, statusBefore: null })).toBe("IN_SERVICE");
  });
  it("but not while a job or a disposal keeps it down, nor without an earlier failure", () => {
    expect(statusAfterCalibration("PASS", { assetStatus: "OUT_OF_SERVICE", previousFailed: true, otherDownJobs: 1 })).toBeNull();
    expect(statusAfterCalibration("PASS", { assetStatus: "OUT_OF_SERVICE", previousFailed: true, disposalPending: true })).toBeNull();
    expect(statusAfterCalibration("PASS", { assetStatus: "OUT_OF_SERVICE", previousFailed: false })).toBeNull();
    expect(statusAfterCalibration("PASS", { assetStatus: "IN_SERVICE", previousFailed: true })).toBeNull();
  });
  it("a held device can't be put in service by hand", () => {
    expect(calibrationHoldProblem(true, "IN_SERVICE")).toMatch(/passing calibration/);
    expect(calibrationHoldProblem(true, "INSTALLED")).not.toBeNull();
    expect(calibrationHoldProblem(true, "UNDER_MAINTENANCE")).toBeNull();
    expect(calibrationHoldProblem(false, "IN_SERVICE")).toBeNull();
  });
});
