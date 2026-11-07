import { describe, expect, it } from "vitest";
import { dueView, triageSort } from "./maintenance";

describe("maintenance triage (wave 19)", () => {
  it("separates devices with no PPM on record from real overdue visits", () => {
    expect(dueView({ state: "OVERDUE", lastPpm: null })).toBe("never");
    expect(dueView({ state: "OVERDUE", lastPpm: "2025-01-01" })).toBe("overdue");
    expect(dueView({ state: "DUE_SOON", lastPpm: null })).toBe("soon");
    expect(dueView({ state: "OK", lastPpm: null })).toBeNull();
  });
  it("puts life support first, then criticality, then the longest overdue", () => {
    const rows = [{ tag: "A", criticality: "LOW", due: "2024-01-01" }, { tag: "B", criticality: "LIFE_SUPPORT", due: "2025-06-01" }, { tag: "C", criticality: "HIGH", due: "2024-05-01" }, { tag: "D", criticality: "LIFE_SUPPORT", due: "2025-01-01" }];
    expect(triageSort(rows).map((r) => r.tag)).toEqual(["D", "B", "C", "A"]);
  });
});
