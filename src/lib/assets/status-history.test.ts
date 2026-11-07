import { describe, expect, it } from "vitest";
import { changesToday, reconstructDays, statusesOn } from "./status-history";

describe("device status by day (wave 16)", () => {
  it("rebuilds past days from downtime, merging overlaps", () => {
    const rows = reconstructDays([
      { assetId: 1, start: "2026-03-10", end: "2026-03-12" },
      { assetId: 1, start: "2026-03-12", end: "2026-03-15" },
      { assetId: 2, start: "2026-06-01", end: null },
      { assetId: 3, start: "2025-01-01", end: "2025-02-01" },
    ], new Map([[1, "IN_SERVICE"], [2, "OUT_OF_SERVICE"], [3, "IN_SERVICE"]]), "2026-01-01", "2026-11-07");
    expect(rows.filter((r) => r.assetId === 1).map((r) => [r.day, r.status])).toEqual([["2026-01-01", "IN_SERVICE"], ["2026-03-10", "OUT_OF_SERVICE"], ["2026-03-16", "IN_SERVICE"]]);
    // Still down: no return to service; its usual status is in service, not its current fault.
    expect(rows.filter((r) => r.assetId === 2).map((r) => [r.day, r.status])).toEqual([["2026-01-01", "IN_SERVICE"], ["2026-06-01", "OUT_OF_SERVICE"]]);
    expect(rows.some((r) => r.assetId === 3)).toBe(false);
    expect(rows.every((r) => r.source === "reconstructed")).toBe(true);
  });
  it("reads statuses on a day from the changes", () => {
    const rows = [
      { assetId: 1, day: "2026-01-01", status: "IN_SERVICE" }, { assetId: 1, day: "2026-03-10", status: "OUT_OF_SERVICE" }, { assetId: 1, day: "2026-03-16", status: "IN_SERVICE" },
      { assetId: 2, day: "2026-05-01", status: "INSTALLED" },
    ];
    expect([...statusesOn(rows, "2026-03-12")]).toEqual([[1, "OUT_OF_SERVICE"]]);
    expect(statusesOn(rows, "2026-05-02").get(2)).toBe("INSTALLED");
    expect(statusesOn(rows, "2026-03-16").get(1)).toBe("IN_SERVICE");
  });
  it("stores only the devices whose status changed", () => {
    expect(changesToday([{ assetId: 1, status: "IN_SERVICE" }, { assetId: 2, status: "OUT_OF_SERVICE" }, { assetId: 3, status: "IN_STOCK" }],
      new Map([[1, "IN_SERVICE"], [2, "IN_SERVICE"]]))).toEqual([{ assetId: 2, status: "OUT_OF_SERVICE" }, { assetId: 3, status: "IN_STOCK" }]);
  });
});
