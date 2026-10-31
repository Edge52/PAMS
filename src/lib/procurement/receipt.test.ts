import { describe, expect, it } from "vitest";
import { outstandingQty, parseSerials, validateOrderQty, validateReceipt } from "./receipt";

const lines = [
  { id: 1, quantity: 4, receivedQty: 1, label: "Patient monitor" },
  { id: 2, quantity: 2, receivedQty: 2, label: "Ventilator" },
  { id: 3, quantity: 3, receivedQty: 0, label: "Syringe pump" },
];

describe("parseSerials", () => {
  it("splits on newlines, commas, semicolons and tabs and trims", () => {
    expect(parseSerials(" A1 \nA2,A3; A4\t\n\n")).toEqual(["A1", "A2", "A3", "A4"]);
    expect(parseSerials("")).toEqual([]);
    expect(parseSerials(null)).toEqual([]);
  });
});

describe("outstandingQty", () => {
  it("never goes negative", () => {
    expect(outstandingQty({ quantity: 3, receivedQty: 1 })).toBe(2);
    expect(outstandingQty({ quantity: 3, receivedQty: 5 })).toBe(0);
  });
});

describe("validateReceipt", () => {
  it("accepts a partial receipt and pads missing serials", () => {
    const r = validateReceipt(lines, [
      { poLineId: 1, qty: 2, serials: ["SN1"] },
      { poLineId: 3, qty: 0, serials: [] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalUnits).toBe(2);
    expect(r.lines).toEqual([{ poLineId: 1, qty: 2, serials: ["SN1", null], newReceivedQty: 3 }]);
  });

  it("rejects receiving more than outstanding", () => {
    const r = validateReceipt(lines, [{ poLineId: 1, qty: 4, serials: [] }]);
    expect(r).toEqual({ ok: false, errors: ["Patient monitor: only 3 units are still outstanding, you entered 4."] });
  });

  it("rejects a fully received line", () => {
    const r = validateReceipt(lines, [{ poLineId: 2, qty: 1, serials: [] }]);
    expect(r.ok).toBe(false);
  });

  it("rejects more serials than units, duplicates and known serials", () => {
    expect(validateReceipt(lines, [{ poLineId: 3, qty: 1, serials: ["A", "B"] }]).ok).toBe(false);
    const dup = validateReceipt(lines, [{ poLineId: 3, qty: 2, serials: ["A", "a"] }]);
    expect(dup.ok).toBe(false);
    const known = validateReceipt(lines, [{ poLineId: 3, qty: 1, serials: ["X9"] }], new Set(["X9"]));
    expect(known).toEqual({ ok: false, errors: ["Serial number X9 is already registered (on an asset or an earlier delivery)."] });
  });

  it("rejects fractional, negative and foreign lines", () => {
    expect(validateReceipt(lines, [{ poLineId: 3, qty: 1.5, serials: [] }]).ok).toBe(false);
    expect(validateReceipt(lines, [{ poLineId: 3, qty: -1, serials: [] }]).ok).toBe(false);
    expect(validateReceipt(lines, [{ poLineId: 99, qty: 1, serials: [] }]).ok).toBe(false);
  });

  it("requires at least one unit", () => {
    expect(validateReceipt(lines, [{ poLineId: 1, qty: 0, serials: [] }])).toEqual({
      ok: false, errors: ["Enter the quantity received for at least one line."],
    });
  });

  it("flags serials entered against a zero quantity", () => {
    expect(validateReceipt(lines, [{ poLineId: 1, qty: 0, serials: ["S"] }]).ok).toBe(false);
  });

  it("caps the new received quantity at the ordered quantity", () => {
    const r = validateReceipt(lines, [{ poLineId: 3, qty: 3, serials: [] }]);
    expect(r.ok && r.lines[0].newReceivedQty).toBe(3);
  });
});

describe("validateOrderQty", () => {
  it("allows up to the offered quantity", () => {
    expect(validateOrderQty(3, 3)).toBeNull();
    expect(validateOrderQty(0, 3)).toBeNull();
    expect(validateOrderQty(4, 3)).toMatch(/at most 3/);
    expect(validateOrderQty(1.5, 3)).toMatch(/whole/);
  });
});
