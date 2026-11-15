import { describe, expect, it } from "vitest";
import { changeSummary, diff, fieldLabel, showValue } from "./audit-diff";

describe("audit trail (wave 24)", () => {
  it("lists only the fields that changed, with both values", () => {
    expect(diff({ status: "IN_SERVICE", roomId: 12, notes: null }, { status: "OUT_OF_SERVICE", roomId: 12, notes: "" }))
      .toEqual({ status: { from: "IN_SERVICE", to: "OUT_OF_SERVICE" } });
    expect(diff({ a: 1 }, { a: 1 })).toBeNull();
  });
  it("treats empty values, equal amounts and equal dates as the same", () => {
    expect(diff({ cost: "100.00", at: new Date("2026-11-14T00:00:00Z"), x: undefined }, { cost: "100", at: new Date("2026-11-14T00:00:00Z"), x: null })).toBeNull();
    expect(diff({ cost: "100.00" }, { cost: "100.50" })).toEqual({ cost: { from: "100", to: "100.5" } });
  });
  it("never records secrets or the database's own times", () => {
    expect(diff({ passwordHash: "a", updatedAt: 1, name: "A" }, { passwordHash: "b", updatedAt: 2, name: "B" })).toEqual({ name: { from: "A", to: "B" } });
  });
  it("compares only the fields asked for", () => {
    expect(diff({ a: 1, b: 1 }, { a: 2, b: 2 }, ["b"])).toEqual({ b: { from: 1, to: 2 } });
  });
  it("words a change for a person", () => {
    expect(fieldLabel("purchaseCost")).toBe("Purchase cost");
    expect(fieldLabel("roomId")).toBe("Room");
    expect(showValue(null)).toBe("empty");
    expect(showValue(true)).toBe("yes");
    expect(changeSummary({ status: { from: "A", to: "B" }, roomId: { from: 1, to: 2 }, c: { from: null, to: "x" }, d: { from: 1, to: 2 } }, 2)).toBe("Status: A → B; Room: 1 → 2; +2 more");
  });
});
