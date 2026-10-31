import { describe, expect, it } from "vitest";
import { planOfferLines } from "./offer-lines";

const types = new Set([10, 20]);
const boq = new Map([[10, new Set([100, 101])]]);

describe("planOfferLines", () => {
  it("validates, keeps ids and drops BOQ links that do not match the device type", () => {
    const p = planOfferLines([1, 2], [
      { id: 1, deviceTypeId: 10, boqLineId: 101, description: "Monitor", quantity: "4", unitPrice: "1000.456", discountPct: "" },
      { deviceTypeId: "20", boqLineId: 100, quantity: 2, unitPrice: 50, isOptional: true },
      { deviceTypeId: "", description: "", unitPrice: "" },
    ], types, boq);
    expect(p.errors).toEqual([]);
    const u = p.update[0];
    expect([u.id, u.boqLineId, u.quantity, u.unitPrice, u.discountPct]).toEqual([1, 101, 4, 1000.46, 0]);
    const i = p.insert[0];
    expect([i.deviceTypeId, i.boqLineId, i.isOptional]).toEqual([20, null, true]);
    expect(p.remove).toEqual([2]);
  });

  it("explains each invalid line", () => {
    const p = planOfferLines([], [
      { deviceTypeId: 99, quantity: 1, unitPrice: 1 },
      { deviceTypeId: 10, quantity: 0, unitPrice: 1 },
      { deviceTypeId: 10, quantity: 1, unitPrice: "abc" },
      { deviceTypeId: 10, quantity: 1, unitPrice: 1, discountPct: 120 },
    ], types);
    expect(p.errors).toEqual([
      "Line 1: choose the device type.",
      "Line 2: quantity must be a whole number of at least 1.",
      "Line 3: enter the unit price.",
      "Line 4: discount must be between 0 and 100%.",
    ]);
  });

  it("requires at least one line", () => {
    expect(planOfferLines([], [], types).errors).toEqual(["Add at least one line with a device type, quantity and price."]);
    expect(planOfferLines([], null, types).errors).toHaveLength(1);
  });
});
