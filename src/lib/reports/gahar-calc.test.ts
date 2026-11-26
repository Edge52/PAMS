import { describe, expect, it } from "vitest";
import { daysToClose, latestSafetyState, median, recallDeviceTally, trainingCoverage, withPreviousDue } from "./gahar-calc";

describe("wave 40 report counting", () => {
  it("gives each calibration the due date set by the one before it", () => {
    const r = withPreviousDue([{ assetId: 1, nextDue: "2026-01-01" }, { assetId: 1, nextDue: "2027-01-01" }, { assetId: 2, nextDue: null }]);
    expect(r.map((x) => x.prevDue)).toEqual([null, "2026-01-01", null]);
  });
  it("reads a device's latest safety test", () => {
    expect(latestSafetyState({ result: "FAIL", nextDue: "2030-01-01" }, "2026-06-01")).toBe("failed");
    expect(latestSafetyState({ result: "PASS", nextDue: "2026-05-01" }, "2026-06-01")).toBe("overdue");
    expect(latestSafetyState({ result: "PASS", nextDue: null }, "2026-06-01")).toBe("in_date");
  });
  it("days to close a recall", () => {
    expect(daysToClose({ issuedDate: "2026-01-01", createdOn: "2026-01-05", closedOn: "2026-01-31" })).toBe(30);
    expect(daysToClose({ issuedDate: null, createdOn: "2026-01-05", closedOn: "2026-01-06" })).toBe(1);
    expect(daysToClose({ issuedDate: null, createdOn: "2026-01-05", closedOn: null })).toBeNull();
  });
  it("recall device tally", () => {
    expect(recallDeviceTally([{ status: "PENDING" }, { status: "ACTIONED" }, { status: "NOT_AFFECTED" }, { status: "ACTIONED" }])).toEqual({ total: 4, pending: 1, actioned: 2, notAffected: 1, donePct: 75 });
    expect(recallDeviceTally([]).donePct).toBeNull();
  });
  it("training coverage counts each pair once", () => {
    expect(trainingCoverage(["1:2:3", "1:2:3", "1:4:3"], new Set(["1:2:3"]))).toEqual({ pairs: 2, covered: 1, pct: 50 });
    expect(trainingCoverage([], new Set()).pct).toBeNull();
  });
  it("median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
